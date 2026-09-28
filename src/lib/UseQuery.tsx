import { useMemo, useSyncExternalStore } from "react";
import type { TetherClient, TetherError } from "@tetherdb/client";
import { useTether } from "./TetherProvider";

export type QueryResult<T> = {
    data: T | undefined
    error: TetherError | null
}

const EMPTY_RESULT: QueryResult<never> = Object.freeze({ data: undefined, error: null })

// useSyncExternalStore requires a snapshot reference that stays the same until
// the cached value or the query error actually changes.
const querySnapshots = new WeakMap<TetherClient, Map<string, QueryResult<unknown>>>()

function readQueryResult<T>(client: TetherClient, queryName: string, paramsString: string): QueryResult<T> {
    const params = JSON.parse(paramsString)
    const data = client.getCache(queryName, params) as T | undefined
    const error = client.getError(queryName, params) ?? null
    let snapshots = querySnapshots.get(client)
    if (!snapshots) {
        snapshots = new Map()
        querySnapshots.set(client, snapshots)
    }
    const key = `${queryName}:${paramsString}`
    const previous = snapshots.get(key) as QueryResult<T> | undefined
    if (previous && previous.data === data && previous.error === error) {
        return previous
    }
    if (data === undefined && error === null) {
        snapshots.set(key, EMPTY_RESULT)
        return EMPTY_RESULT as QueryResult<T>
    }
    const next: QueryResult<T> = { data, error }
    snapshots.set(key, next)
    return next
}

export function useQuery<T = any>(queryName: string, params: Record<string, any> | "pass" = {}): QueryResult<T> {
    const { tetherClient } = useTether()
    const skip = params === "pass"
    const paramsString = skip ? "" : JSON.stringify(params)

    const subscribe = useMemo(() => {
        return (onStoreChange: () => void) => {
            if (skip || !tetherClient) {
                return () => {}
            }
            return tetherClient.subscribe(queryName, JSON.parse(paramsString), onStoreChange)
        }
    }, [tetherClient, queryName, paramsString, skip])

    const getSnapshot = useMemo(() => {
        return () => {
            if (skip || !tetherClient) {
                return EMPTY_RESULT as QueryResult<T>
            }
            return readQueryResult<T>(tetherClient, queryName, paramsString)
        }
    }, [tetherClient, queryName, paramsString, skip])

    return useSyncExternalStore(
        subscribe,
        getSnapshot,
        () => EMPTY_RESULT as QueryResult<T>,
    )
}
