import type { ReactNode } from "react"
import { useTether } from "./TetherProvider"

/**
 * Renders `children` only while the session is authenticated.
 *
 * Renders nothing until the client reports an authenticated user. Pair this
 * with {@link Unauthenticated} for the signed-out tree.
 *
 * @param children - Content that requires a session.
 */
export function Authenticated({ children }: { children: ReactNode }) {
    const { authState } = useTether()
    if (!authState.authenticated) {
        return null
    }
    return children
}

/**
 * Renders `children` while no session is authenticated.
 *
 * This includes the time before the first auth snapshot arrives, when the
 * provider still reports a logged-out state.
 *
 * @param children - Content for signed-out visitors.
 */
export function Unauthenticated({ children }: { children: ReactNode }) {
    const { authState } = useTether()
    if (authState.authenticated) {
        return null
    }
    return children
}
