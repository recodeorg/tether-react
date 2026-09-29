import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { TetherClient, type AuthState } from "@tetherdb/client"

const LOGGED_OUT: AuthState = Object.freeze({ authenticated: false, userId: null, error: null })

function authSnapshot(state: AuthState): AuthState {
    if (!state.authenticated && state.userId === null && state.error === null) {
        return LOGGED_OUT
    }
    return state
}

const TetherContext = createContext<{tetherClient: TetherClient, token: string | null, setToken: (token: string) => void, logout: () => void, authState: AuthState}|null>(null);

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

    return <TetherContext.Provider value={{tetherClient, token, setToken, logout, authState}}>{children}</TetherContext.Provider>
}

export const useTether = () => {
    const context = useContext(TetherContext)
    if (!context) {
        throw new Error("useTether must be used within a TetherProvider")
    }
    return context
}