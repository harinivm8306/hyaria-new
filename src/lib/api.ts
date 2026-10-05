// Single place for the backend URL. Set NEXT_PUBLIC_API_URL in .env.local for deployments.
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
export const DEVICE_ID = process.env.NEXT_PUBLIC_DEVICE_ID || "tower-1";

export async function apiGet<T = any>(path: string, timeoutMs = 8000): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(`${API_BASE}${path}`, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        return (await res.json()) as T;
    } finally {
        clearTimeout(t);
    }
}

export async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}

export async function apiUpload<T = any>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as T;
}
