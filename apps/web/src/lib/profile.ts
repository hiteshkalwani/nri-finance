import { useQuery } from '@tanstack/vue-query'
import { MeResponse } from '@nri/contracts'
import { apiFetch } from './api'

export const useProfile = () => useQuery({ queryKey: ['me'], queryFn: () => apiFetch('/api/me', {}, MeResponse) })
