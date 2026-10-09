import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { TetherClient, type AuthState } from "@tetherdb/client"

const LOGGED_OUT: AuthState = Object.freeze({ authenticated: false, userId: null, error: null })

const DEFAULT_PREFETCH_TTL_MS = 30_000

/**
 * How long a {@link Prefetch} subscription stays open.
 */
export type PrefetchOptions = {
    /**
     * Milliseconds to keep the subscription open.
     *
     * Defaults to 30 seconds.
     */
    ttl?: number
}

/**
 * Controls a prefetch started by {@link Prefetch}.
 *
 * @typeParam T - Value of the first data frame.
 */
export type PrefetchHandle<T> = {
    /** Closes the subscription before {@link PrefetchOptions.ttl} elapses. */
    unsubscribe: () => void
    /**
     * Resolves with the first data frame.
     *
     * Rejects if the query fails, or if the prefetch ends before a frame
     * arrives. A logout clears the query without an error, so this stays
     * pending until the prefetch ends and then rejects.
     *
     * The promise is already handled on the handle. Await it when the next
     * screen needs that first frame.
     */
    ready: Promise<T>
}

/**
 * Opens a query subscription ahead of the component that will read it.
 *
 * The subscription fills the client cache, then closes after
 * {@link PrefetchOptions.ttl} unless {@link PrefetchHandle.unsubscribe} runs first.
 *
 * @typeParam T - Value of the first data frame.
 * @param queryName - Name of the query defined on the server.
 * @param params - Arguments passed to the query. Defaults to `{}`.
 * @param options - How long to keep the subscription open.
 * @returns A handle for the warm subscription.
 */
export type Prefetch = <T = any>(queryName: string, params?: Record<string, any>, options?: PrefetchOptions) => PrefetchHandle<T>

/**
 * Props for {@link TetherProvider}.
 */
export type TetherProviderProps = {
    /** Tree that may call the Tether hooks. */
    children: ReactNode
    /**
     * WebSocket URL of the Tether server.
     *
     * A new value disconnects from the previous server and connects to the next one.
     */
    url: string
}

/**
 * Client, session, and helpers shared with every hook under {@link TetherProvider}.
 */
export type TetherContextValue = {
    /** Connected {@link TetherClient}. */
    tetherClient: TetherClient
    /**
     * Token last stored with {@link TetherContextValue.setToken}.
     *
     * `null` until a token is set.
     */
    token: string | null
    /**
     * Stores an auth token and sends it on the connection.
     *
     * Pass an empty string to clear the token.
     *
     * @param token - Auth token the server should receive.
     */
    setToken: (token: string) => void
    /** Ends the server session and clears the stored token. */
    logout: () => void
    /** Subscribes to a query before the component that reads it is rendered. */
    prefetch: Prefetch
    /**
     * Latest authentication snapshot.
     *
     * Stays logged out until the client reports a session. The snapshot used
     * during server rendering is logged out as well.
     */
    authState: AuthState
    /** WebSocket URL this provider connected to. */
    url: string
}

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

/**
 * Context that holds a {@link TetherContextValue}.
 *
 * Read it through {@link useTether}.
 */
export const TetherContext = createContext<TetherContextValue | null>(null);

/**
 * Connects to a Tether server and provides that connection to descendant hooks.
 *
 * Mount this once above any component that calls {@link useTether}, `useQuery`,
 * `usePaginatedQuery`, or `useMutation`. The provider creates one client,
 * connects to `url`, and disconnects when it unmounts.
 *
 * @example
 * ```tsx
 * <TetherProvider url="wss://example.com/tether">
 *   <App />
 * </TetherProvider>
 * ```
 */
export const TetherProvider = ({ children, url }: TetherProviderProps) => {
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

/**
 * Returns the {@link TetherContextValue} from the nearest {@link TetherProvider}.
 *
 * @returns The client, auth state, and session helpers for this tree.
 * @throws If no {@link TetherProvider} is mounted above the caller.
 *
 * @example
 * ```tsx
 * const { authState, logout } = useTether()
 * ```
 */
export const useTether = (): TetherContextValue => {
    const context = useContext(TetherContext)
    if (!context) {
        throw new Error("useTether must be used within a TetherProvider")
    }
    return context
}
