import { useState, useCallback } from "react";
import { useTether } from "./TetherProvider";

/**
 * A mutation bound to the client from {@link useTether}.
 *
 * @typeParam TParams - Arguments accepted by {@link MutationResult.mutate}.
 * @typeParam TResult - Value the mutation resolves with.
 */
export type MutationResult<TParams, TResult> = {
    /**
     * Sends the mutation and resolves with the server result.
     *
     * On failure, stores the error on {@link MutationResult.error} and throws it.
     *
     * @param params - Arguments forwarded to the server.
     */
    mutate: (params: TParams) => Promise<TResult>
    /** True while at least one {@link MutationResult.mutate} call has not settled. */
    isPending: boolean
    /**
     * Failure from the latest call.
     *
     * Cleared when a later call starts, and `null` before the first failure.
     */
    error: Error | null
}

/**
 * Prepares a Tether mutation.
 *
 * Several calls may be in flight at once. {@link MutationResult.isPending}
 * stays true until all of them settle.
 *
 * @typeParam TParams - Arguments accepted by {@link MutationResult.mutate}. Defaults to a string-keyed record.
 * @typeParam TResult - Value {@link MutationResult.mutate} resolves with.
 * @param mutationName - Name of the mutation defined on the server.
 * @returns The mutate function plus pending and error state.
 *
 * @example
 * ```tsx
 * const { mutate, isPending } = useMutation<{ roomId: string, text: string }, Message>("sendMessage")
 * await mutate({ roomId, text })
 * ```
 */
export function useMutation<TParams = Record<string, any>, TResult = any>(mutationName: string): MutationResult<TParams, TResult> {
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