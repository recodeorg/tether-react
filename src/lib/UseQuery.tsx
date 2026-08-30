import { useSyncExternalStore, useMemo } from "react";
import { useTether } from "./TetherProvider";

export function useQuery<T = any>(queryName: string, params: Record<string, any> | "pass" = {}): T | undefined {
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
                return undefined
            }
            return tetherClient.getCache(queryName, JSON.parse(paramsString))
        }
    }, [tetherClient, queryName, paramsString, skip])

    return useSyncExternalStore(subscribe, getSnapshot)
}