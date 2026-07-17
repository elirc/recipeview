import type {
  Dish,
  DishDetail,
  RecipeDetail,
  CookLog,
  CookLogInput,
  SearchHit,
  Photo,
} from '@shared/types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  // dishes
  listDishes: (params: { tag?: string; sort?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.tag) q.set('tag', params.tag);
    if (params.sort) q.set('sort', params.sort);
    const qs = q.toString();
    return req<Dish[]>(`/api/dishes${qs ? `?${qs}` : ''}`);
  },
  getDish: (id: number) => req<DishDetail>(`/api/dishes/${id}`),
  createDish: (body: { name: string; notes?: string; tags?: string[] }) =>
    req<DishDetail>('/api/dishes', { method: 'POST', body: json(body) }),
  updateDish: (id: number, body: Partial<{ name: string; notes: string; tags: string[] }>) =>
    req<DishDetail>(`/api/dishes/${id}`, { method: 'PATCH', body: json(body) }),
  deleteDish: (id: number) => req<void>(`/api/dishes/${id}`, { method: 'DELETE' }),

  // recipes
  getRecipe: (id: number) => req<RecipeDetail>(`/api/recipes/${id}`),
  createRecipe: (dishId: number, body: Record<string, unknown>) =>
    req<RecipeDetail>(`/api/dishes/${dishId}/recipes`, { method: 'POST', body: json(body) }),
  updateRecipe: (id: number, body: Record<string, unknown>) =>
    req<RecipeDetail>(`/api/recipes/${id}`, { method: 'PATCH', body: json(body) }),
  deleteRecipe: (id: number) => req<void>(`/api/recipes/${id}`, { method: 'DELETE' }),

  // cook logs
  createLog: (recipeId: number, body: CookLogInput) =>
    req<CookLog>(`/api/recipes/${recipeId}/logs`, { method: 'POST', body: json(body) }),
  updateLog: (id: number, body: CookLogInput) =>
    req<CookLog>(`/api/logs/${id}`, { method: 'PATCH', body: json(body) }),
  deleteLog: (id: number) => req<void>(`/api/logs/${id}`, { method: 'DELETE' }),

  // photos
  uploadPhotos: (logId: number, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('photos', f);
    return req<Photo[]>(`/api/logs/${logId}/photos`, { method: 'POST', body: fd });
  },
  deletePhoto: (id: number) => req<void>(`/api/photos/${id}`, { method: 'DELETE' }),

  // search & tags
  search: (q: string) => req<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  tags: () => req<{ id: number; name: string; uses: number }[]>('/api/tags'),
};
