import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { TetherClient, type AuthState } from "@tetherdb/client"

const LOGGED_OUT: AuthState = Object.freeze({ authenticated: false, userId: null, error: null })

const DEFAULT_PREFETCH_TTL_MS = 30_000

export type PrefetchOptions = {
    /** Milliseconds to keep the subscription open. Defaults to 30 seconds. */
    ttl?: number
}

export type PrefetchHandle<T> = {
    /** Closes the prefetch subscription before the ttl runs out. */
    unsubscribe: () => void
    /** Resolves with the first data frame. Rejects on a query error, or if the prefetch ends before data arrives. */
    ready: Promise<T>
}

export type Prefetch = <T = any>(queryName: string, params?: Record<string, any>, options?: PrefetchOptions) => PrefetchHandle<T>

function authSnapshot(state: AuthState): AuthState {
    if (!state.authenticated && state.userId === null && state.error === null) {
        return LOGGED_OUT
    }
    return state
}

function prefetchQuery<T>(client: TetherClient, queryName: string, params: Record<string, any>, options: PrefetchOptions): PrefetchHandle<T> {
    let resolveReady!: (data: T) => void
    let rejectReady!: (reason: unknown) => void
    const ready = new Promise<T>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
    })
    // Callers that only want a warm cache never await this.
    ready.catch(() => {})

    const release = client.subscribe(queryName, params, (data, error) => {
        if (error) {
            rejectReady(error)
        } else if (data !== undefined) {
            // Logout delivers undefined with no error.
            resolveReady(data as T)
        }
    })

    let active = true
    const unsubscribe = () => {
        if (!active) {
            return
        }
        active = false
        clearTimeout(timer)
        release()
        rejectReady(new Error(`Prefetch of ${queryName} ended before the first data frame arrived`))
    }
    const timer = setTimeout(unsubscribe, options.ttl ?? DEFAULT_PREFETCH_TTL_MS)

    return { unsubscribe, ready }
}

export const TetherContext = createContext<{tetherClient: TetherClient, token: string | null, setToken: (token: string) => void, logout: () => void, prefetch: Prefetch, authState: AuthState, url: string}|null>(null);

export const TetherProvider = ({ children, url }: { children: ReactNode, url: string }) => {
    const [tetherClient] = useState(() => new TetherClient())
    const [token, setToken] = useState<string | null>(null)
    const authState = useSyncExternalStore(
        tetherClient.onAuthentication,
        () => authSnapshot(tetherClient.getAuthState()),
        () => LOGGED_OUT,
    )
    
    useEffect(() => {
        console.log("Connecting to", url)
        tetherClient.connect(url)

        return () => {
            console.log("Disconnecting from", url)
            tetherClient.disconnect()
        }
    }, [tetherClient, url])

    useEffect(() => {
        if (token) {
            tetherClient.setToken(token)
        } else {
            tetherClient.setToken("")
        }
    }, [token, tetherClient])

    const logout = () => {
        tetherClient.logout();
        setToken("")
    }

    const prefetch = useCallback<Prefetch>(
        (queryName, params = {}, options = {}) => prefetchQuery(tetherClient, queryName, params, options),
        [tetherClient],
    )

    return <TetherContext.Provider value={{tetherClient, token, setToken, logout, prefetch, authState, url}}>{children}</TetherContext.Provider>
}

export const useTether = () => {
    const context = useContext(TetherContext)
    if (!context) {
        throw new Error("useTether must be used within a TetherProvider")
    }
    return context
}
