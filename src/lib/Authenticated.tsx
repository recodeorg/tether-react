import type { ReactNode } from "react"
import { useTether } from "./TetherProvider"

export function Authenticated({ children }: { children: ReactNode }) {
    const { authState } = useTether()
    if (!authState.authenticated) {
        return null
    }
    return children
}

export function Unauthenticated({ children }: { children: ReactNode }) {
    const { authState } = useTether()
    if (authState.authenticated) {
        return null
    }
    return children
}
