import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { TetherClient } from "@tetherdb/client"

const TetherContext = createContext<{tetherClient: TetherClient, token: string | null, setToken: (token: string) => void, logout: () => void}|null>(null);

export const TetherProvider = ({ children, url }: { children: ReactNode, url: string }) => {
    const [tetherClient] = useState(() => new TetherClient())
    const [token, setToken] = useState<string | null>(null)
    
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

    return <TetherContext.Provider value={{tetherClient, token, setToken, logout}}>{children}</TetherContext.Provider>
}

export const useTether = () => {
    const context = useContext(TetherContext)
    if (!context) {
        throw new Error("useTether must be used within a TetherProvider")
    }
    return context
}