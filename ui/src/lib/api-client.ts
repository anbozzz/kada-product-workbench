export class ApiError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = "") {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

export async function requestJson<T>(
  input: string,
  init: RequestInit | undefined,
  fallbackError: string,
): Promise<T> {
  const prefix = (window as Window & { __publicationPrefix?: string }).__publicationPrefix || ""
  const response = await fetch(prefix && input.startsWith("/api/") ? prefix + input : input, init)
  if (prefix && [401, 409].includes(response.status)) window.dispatchEvent(new CustomEvent("publication-error", { detail: response.status }))
  const result = await response.json()
  if (!response.ok) {
    const message = result.error || result.errors?.join("；") || fallbackError
    throw new ApiError(message, response.status, result.code || "")
  }
  return result as T
}

export const postJson = <T>(input: string, body: unknown, fallbackError: string) =>
  requestJson<T>(input, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, fallbackError)
