/**
 * React hooks and components for a Tether server.
 *
 * Wrap the tree in {@link TetherProvider}, then read with {@link useQuery} or
 * {@link usePaginatedQuery} and write with {@link useMutation}.
 *
 * @packageDocumentation
 */
export { useMutation } from "./UseMutation.js"
export type { MutationResult } from "./UseMutation.js"
export { useQuery } from "./UseQuery.js"
export type { QueryResult } from "./UseQuery.js"
export { usePaginatedQuery } from "./UsePaginatedQuery.js"
export type { PaginatedQueryResult } from "./UsePaginatedQuery.js"
export { TetherProvider, useTether } from "./TetherProvider.js"
export type { Prefetch, PrefetchHandle, PrefetchOptions, TetherContextValue, TetherProviderProps } from "./TetherProvider.js"
export { Authenticated, Unauthenticated } from "./Authenticated.js"
export type { AuthState } from "@tetherdb/client"
