import { useState, useCallback } from "react";
import { useTether } from "./TetherProvider";

export function useMutation<TParams = Record<string, any>, TResult = any>(mutationName: string) {
    const { tetherClient } = useTether();
    const [pendingCount, setPendingCount] = useState(0);
    const [error, setError] = useState<Error | null>(null);

    const mutate = useCallback(async (params: TParams): Promise<TResult> => {
        setPendingCount(c => c + 1);
        setError(null);
        
        try {
            const result = await tetherClient.sendMutation(mutationName, params) as TResult;
            return result;
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            setError(err);
            throw err; 
        } finally {
            setPendingCount(c => Math.max(0, c - 1)); // Math.max just as a safety net
        }
    }, [tetherClient, mutationName]);

    return { mutate, isPending: pendingCount > 0, error };
}