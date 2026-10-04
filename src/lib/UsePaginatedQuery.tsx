import { useMemo, useSyncExternalStore } from "react";
import { TetherError, type TetherClient } from "@tetherdb/client";
import { useTether } from "./TetherProvider";

export type PaginatedQueryResult<T> = {
    data: T[] | undefined
    error: TetherError | null
    hasMore: boolean
    loadMore: () => void
}

type PageResponse<T> = {
    Data: T[]
    StartCursor: string | null
    EndCursor: string | null
    HasMore: boolean
    MaxSize: number
}

// The server reads both cursors as exclusive bounds: rows older than start and
// newer than end. A cursor names a real row, so a page can never lock a bound
// to its own boundary row without dropping it. Each lock takes the cursor of
// the neighbouring page's nearest row instead, which is why a lock waits until
// that neighbour has loaded.
type Bounds = { start: string | null, end: string | null }

type Page = Bounds & {
    // start is still null and locks to the EndCursor of the page above.
    startPending: boolean
    // end locks to the StartCursor of the page below.
    endPending: boolean
    // Bounds of the subscription on screen. A page keeps showing its old
    // subscription until the one for its new bounds has loaded.
    shown: Bounds | null
}

type Subscription<T> = {
    unsubscribe: () => void
    response: PageResponse<T> | undefined
    error: TetherError | null
    // Latest response from before rows of a neighbouring page entered it.
    clean: PageResponse<T> | undefined
    // Response that already opened a gap page below this one.
    overflowed: PageResponse<T> | undefined
}

const EMPTY_RESULT: PaginatedQueryResult<never> = Object.freeze({
    data: undefined,
    error: null,
    hasMore: false,
    loadMore: () => {},
})

const noopSubscribe = () => () => {}
const emptySnapshot = () => EMPTY_RESULT

const boundsKey = ({ start, end }: Bounds) => JSON.stringify([start, end])

function cursor(value: unknown): string | null {
    return typeof value === "string" && value !== "" ? value : null
}

function newPage(start: string | null, end: string | null): Page {
    return { start, end, startPending: false, endPending: false, shown: null }
}

// A page does not resubscribe while its end waits on the page below: tightening
// its start first would slide its window down onto rows that page holds. That
// wait lasts one load. A pending start can wait for new rows indefinitely, so
// it does not hold back an end lock.
function canResubscribe(page: Page) {
    return !page.endPending
}

function readResponse<T>(data: unknown): PageResponse<T> | undefined {
    if (data === null || typeof data !== "object") {
        return undefined
    }
    const response = data as Record<string, unknown>
    return {
        Data: Array.isArray(response.Data) ? response.Data as T[] : [],
        StartCursor: cursor(response.StartCursor),
        EndCursor: cursor(response.EndCursor),
        HasMore: response.HasMore === true,
        MaxSize: typeof response.MaxSize === "number" ? response.MaxSize : 0,
    }
}

// With exclusive bounds a page can never begin at its own end or stop at its
// own start. A query that ignores its cursors keeps returning the same full
// page, and acting on it would open new pages without end.
function ignoresBounds<T>(response: PageResponse<T>, { start, end }: Bounds) {
    return (end !== null && response.StartCursor === end) || (start !== null && response.EndCursor === start)
}

// Pages run newest to oldest. pages[0] is the active page: its start is
// always null, so it takes every new row until it fills and a newer page
// replaces it.
class PaginatedQuery<T> {
    private client: TetherClient
    private queryName: string
    private args: Record<string, unknown>
    private pages: Page[] = [newPage(null, null)]
    private subscriptions = new Map<string, Subscription<T>>()
    private listeners = new Set<() => void>()
    private updating = false
    private dirty = false
    private snapshot: PaginatedQueryResult<T>

    constructor(client: TetherClient, queryName: string, args: Record<string, unknown>) {
        this.client = client
        this.queryName = queryName
        this.args = args
        this.snapshot = { ...EMPTY_RESULT, loadMore: this.loadMore }
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener)
        if (this.listeners.size === 1) {
            this.update()
        }
        return () => {
            this.listeners.delete(listener)
            if (this.listeners.size === 0) {
                for (const subscription of this.subscriptions.values()) {
                    subscription.unsubscribe()
                }
                this.subscriptions.clear()
            }
        }
    }

    getSnapshot = () => this.snapshot

    loadMore = () => {
        const last = this.pages.length - 1
        const response = this.settledResponse(last)
        if (!response?.HasMore || response.EndCursor === null) {
            return
        }
        this.pages[last].endPending = true
        this.pages.push(newPage(response.EndCursor, null))
        this.update()
    }

    private shownSubscription(page: Page) {
        return page.shown ? this.subscriptions.get(boundsKey(page.shown)) : undefined
    }

    // A subscription whose bound towards a neighbour is not locked yet (the
    // lock is pending or still loading) can take rows that belong to that
    // neighbour: newer rows reach the top of an open start, and a deletion
    // pulls older rows into a wide end. Until then its edge row is the
    // neighbour's bound.
    private cleanAbove(index: number, response: PageResponse<T>) {
        return index === 0 || this.pages[index].shown?.start !== null || response.StartCursor === this.pages[index - 1].end
    }

    private cleanBelow(index: number, response: PageResponse<T>) {
        const page = this.pages[index]
        const locked = !page.endPending && page.end !== null && page.shown?.end === page.end
        return index === this.pages.length - 1 || locked || response.EndCursor === this.pages[index + 1].start
    }

    // Decisions use a page's last response from before rows of a neighbour
    // reached it.
    private settledResponse(index: number) {
        const subscription = this.shownSubscription(this.pages[index])
        const response = subscription?.response
        if (!subscription || !response) {
            return undefined
        }
        if (this.cleanAbove(index, response) && this.cleanBelow(index, response)) {
            subscription.clean = response
            return response
        }
        return subscription.clean
    }

    private update() {
        if (this.updating) {
            this.dirty = true
            return
        }
        this.updating = true
        try {
            do {
                this.dirty = false
                this.advance()
                this.syncSubscriptions()
            } while (this.dirty)
        } finally {
            this.updating = false
        }
        this.snapshot = this.buildSnapshot()
        for (const listener of [...this.listeners]) {
            listener()
        }
    }

    private receive(subscription: Subscription<T>, bounds: Bounds, data: unknown, error: Error | null) {
        let response = readResponse<T>(data)
        if (response !== undefined && ignoresBounds(response, bounds)) {
            response = undefined
            error = new TetherError(`${this.queryName} returned rows outside its StartCursor and EndCursor`)
        }
        if (response === undefined && error === null && subscription.response !== undefined) {
            // The client clears every query on logout. Bounds found while
            // signed in do not describe what the next user can see.
            this.pages = [newPage(null, null)]
        }
        subscription.response = response
        subscription.error = error as TetherError | null
        this.update()
    }

    private advance() {
        const pages = this.pages

        for (const page of pages) {
            const current = canResubscribe(page) ? this.subscriptions.get(boundsKey(page))?.response : undefined
            if (current && (!page.shown || boundsKey(page.shown) !== boundsKey(page))) {
                page.shown = { start: page.start, end: page.end }
                this.dirty = true
            }
        }

        const last = pages[pages.length - 1]
        const oldest = this.settledResponse(pages.length - 1)
        if (pages.length > 1 && last.end === null && oldest && oldest.Data.length === 0) {
            // Nothing is older than the page above it, which can stay open
            // towards older rows and take over hasMore.
            pages.pop()
            pages[pages.length - 1].endPending = false
            this.dirty = true
        }

        const latest = this.settledResponse(0)
        if (latest && latest.MaxSize > 0 && latest.Data.length >= latest.MaxSize && latest.StartCursor !== null) {
            pages[0].startPending = true
            pages.unshift(newPage(null, latest.StartCursor))
            this.dirty = true
        }

        for (let i = 0; i < pages.length - 1; i++) {
            const upper = pages[i]
            const lower = pages[i + 1]
            const above = this.settledResponse(i)
            const overflowing = above !== undefined && above.HasMore && above.Data.length >= above.MaxSize
            const upperSubscription = this.shownSubscription(upper)
            const onTarget = upper.shown !== null && boundsKey(upper.shown) === boundsKey(upper)

            if (overflowing && onTarget && !upper.endPending && upperSubscription && upperSubscription.overflowed !== above) {
                // More rows fall inside upper's bounds than one page holds, so
                // the oldest of them are in neither upper nor lower.
                upperSubscription.overflowed = above
                pages.splice(i + 1, 0, newPage(above.EndCursor, upper.end))
                upper.endPending = true
                this.dirty = true
                continue
            }

            if (lower.startPending && upper.shown && above && !overflowing) {
                if (above.Data.length > 0) {
                    lower.start = above.EndCursor
                    lower.startPending = false
                    this.dirty = true
                } else if (upper.shown.start !== null) {
                    lower.start = upper.shown.start
                    lower.startPending = false
                    this.dirty = true
                }
            }

            const below = this.settledResponse(i + 1)
            if (upper.endPending && lower.shown && below) {
                if (below.Data.length > 0) {
                    upper.end = below.StartCursor
                    upper.endPending = false
                    this.dirty = true
                } else if (lower.shown.end !== null) {
                    upper.end = lower.shown.end
                    upper.endPending = false
                    this.dirty = true
                }
            }
        }
    }

    private syncSubscriptions() {
        if (this.listeners.size === 0) {
            return
        }
        const wanted = new Map<string, Bounds>()
        for (const page of this.pages) {
            if (canResubscribe(page)) {
                wanted.set(boundsKey(page), { start: page.start, end: page.end })
            }
            if (page.shown) {
                wanted.set(boundsKey(page.shown), page.shown)
            }
        }
        for (const [key, subscription] of this.subscriptions) {
            if (!wanted.has(key)) {
                this.subscriptions.delete(key)
                subscription.unsubscribe()
            }
        }
        for (const [key, bounds] of wanted) {
            if (this.subscriptions.has(key)) {
                continue
            }
            const subscription: Subscription<T> = {
                unsubscribe: () => {},
                response: undefined,
                error: null,
                clean: undefined,
                overflowed: undefined,
            }
            this.subscriptions.set(key, subscription)
            const params = { ...this.args, StartCursor: bounds.start, EndCursor: bounds.end }
            subscription.unsubscribe = this.client.subscribe(this.queryName, params, (data, error) => {
                if (this.subscriptions.get(key) === subscription) {
                    this.receive(subscription, bounds, data, error)
                }
            })
        }
    }

    private buildSnapshot(): PaginatedQueryResult<T> {
        const rows: T[] = []
        let loaded = false
        let error: TetherError | null = null
        let newestListed: string | null = null
        this.pages.forEach((page, i) => {
            const shown = this.shownSubscription(page)
            error ??= this.subscriptions.get(boundsKey(page))?.error ?? shown?.error ?? null
            const live = shown?.response
            if (!live) {
                return
            }
            loaded = true
            const settled = this.settledResponse(i)
            let listed = live
            if (settled !== live && (rows.length > 0 || !this.cleanBelow(i, live))) {
                if (settled) {
                    listed = settled
                } else if (!this.cleanAbove(i, live)) {
                    // Subscribed after newer rows had already reached it. When
                    // the pages above list the same newest row, those rows
                    // head its response. Otherwise it waits for an update
                    // rather than risk listing rows twice.
                    if (live.StartCursor === newestListed) {
                        rows.push(...live.Data.slice(Math.min(live.Data.length, rows.length)))
                    }
                    return
                }
            }
            if (newestListed === null && listed.Data.length > 0) {
                newestListed = listed.StartCursor
            }
            rows.push(...listed.Data)
        })

        const last = this.settledResponse(this.pages.length - 1)
        return {
            data: loaded ? rows : undefined,
            error,
            hasMore: last ? last.HasMore : this.pages.length > 1,
            loadMore: this.loadMore,
        }
    }
}

export function usePaginatedQuery<T = any>(queryName: string, params: Record<string, any> | "pass" = {}): PaginatedQueryResult<T> {
    const { tetherClient } = useTether()
    const skip = params === "pass"
    const paramsString = skip ? "" : JSON.stringify(params)

    const query = useMemo(() => {
        if (skip || !tetherClient) {
            return null
        }
        return new PaginatedQuery<T>(tetherClient, queryName, JSON.parse(paramsString))
    }, [tetherClient, queryName, paramsString, skip])

    return useSyncExternalStore(
        query?.subscribe ?? noopSubscribe,
        query?.getSnapshot ?? (emptySnapshot as () => PaginatedQueryResult<T>),
        emptySnapshot as () => PaginatedQueryResult<T>,
    )
}
