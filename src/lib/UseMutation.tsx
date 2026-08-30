import { useState } from "react";
import { useTether } from "./TetherProvider";

// We add TParams and TResult generics!
export function useMutation<TParams = Record<string, any>, TResult = any>(mutationName: string) {
    const { tetherClient } = useTether();
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    // The function now strictly enforces TParams and promises TResult
    const mutate = async (params: TParams): Promise<TResult> => {
        setIsPending(true);
        setError(null);
        
        try {
            const result = await tetherClient.sendMutation(mutationName, params) as TResult;
            return result;
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            setError(err);
            throw err; 
        } finally {
            setIsPending(false);
        }
    };

    return { mutate, isPending, error };
}