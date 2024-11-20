/**
 * HttpClient Module
 *
 * A simple and flexible HTTP client for making requests with customizable options.
 * This module provides an easy-to-use interface for sending GET, POST, PUT, PATCH,
 * and DELETE requests, along with a builder pattern for configuring the request.
 *
 * The `HttpClient` class allows setting request parameters such as headers, body,
 * timeout, credentials, and more. It supports various response types such as JSON,
 * text, blobs, and streams. Additionally, it allows for advanced options like custom
 * fetch implementations, cache control, and more.
 *
 * Usage:
 * ```ts
 * const client = new HttpClient({ baseUrl: 'https://jsonplaceholder.typicode.com' });
 *
 * // Sending a GET request
 * const response = await client.get('todos', 1).json();
 *
 * // Sending a POST request with JSON body
 * const response = await client.post('todos').body({ key: 'value' }).json();
 * ```
 *
 * @module HttpClient
 */

type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [x: string]: JSONValue }
  | Array<JSONValue>;

type JSONBody =
  | string
  | number
  | boolean
  | null
  | { toJSON: () => JSONValue }
  | { [x: string]: JSONBody }
  | Array<JSONBody>;

type Fetch = typeof globalThis.fetch;
type URLSearchParamsInit =
  | string[][]
  | Record<string, string>
  | string
  | URLSearchParams;

/**
 * Configuration options for the HttpClient and Builder classes.
 */
export interface Options {
  /**
   * The base URL to prepend to all request paths.
   * If not specified, request paths must be fully qualified URLs.
   */
  baseUrl?: string;

  /**
   * A function to be called before sending a request, allowing modifications to the Request object.
   * @param request - The Request object to be modified.
   * @returns Optional Promise to wait before continuing.
   */
  beforeSend?: (request: Request) => void | Promise<void>;

  /**
   * The caching mode of the request (e.g., "default", "no-store").
   */
  cache?: RequestCache;

  /**
   * The credentials mode for the request (e.g., "include", "same-origin").
   */
  credentials?: RequestCredentials;

  /**
   * A custom fetch function to use for requests.
   * Defaults to the global `fetch` function.
   */
  fetch?: Fetch;

  /**
   * Subresource integrity metadata for the request.
   */
  integrity?: string;

  /**
   * Indicates whether the request should persist beyond page unloads.
   */
  keepalive?: boolean;

  /**
   * The request mode (e.g., "cors", "same-origin").
   */
  mode?: RequestMode;

  /**
   * The priority of the request (e.g., "high", "low").
   */
  priority?: RequestPriority;

  /**
   * The redirect behavior for the request (e.g., "follow", "manual").
   */
  redirect?: RequestRedirect;

  /**
   * The referrer URL for the request.
   */
  referrer?: string;

  /**
   * The referrer policy for the request (e.g., "no-referrer", "origin").
   */
  referrerPolicy?: ReferrerPolicy;

  /**
   * The timeout duration for the request in milliseconds.
   * Defaults to 10,000 ms (10 seconds) if not specified.
   */
  timeout?: number;
}

type Path = readonly (number | string)[];

export class HttpClient {
  #options: Options;

  constructor(options: Options = {}) {
    this.#options = options;
  }

  #pathname(path: Path): string {
    const segments: string[] = [];
    for (let segment of path) {
      if (typeof segment === "number") {
        segments.push(String(segment));
        continue;
      }
      segment = segment.trim();
      if (segment.startsWith("/")) {
        segment = segment.slice(1);
      }
      if (segment.endsWith("/")) {
        segment = segment.slice(0, -1);
      }
      if (segment.length > 0) {
        segments.push(segment);
      }
    }
    return segments.join("/");
  }

  #build(method: string, path: Path): Builder {
    const { baseUrl, ...options } = this.#options;
    const pathname = this.#pathname(path);
    const url = new URL(pathname, baseUrl);
    return new Builder(method, url, options);
  }

  /**
   * Initiates a GET request to the specified path.
   * @param path - The path segments to construct the URL.
   * @returns A BuilderWithoutBody instance for further configuration.
   */
  get(...path: Path): BuilderWithoutBody {
    return this.#build("GET", path);
  }

  /**
   * Initiates a POST request to the specified path.
   * @param path - The path segments to construct the URL.
   * @returns A Builder instance for further configuration.
   */
  post(...path: Path): Builder {
    return this.#build("POST", path);
  }

  /**
   * Initiates a PUT request to the specified path.
   * @param path - The path segments to construct the URL.
   * @returns A Builder instance for further configuration.
   */
  put(...path: Path): Builder {
    return this.#build("PUT", path);
  }

  /**
   * Initiates a PATCH request to the specified path.
   * @param path - The path segments to construct the URL.
   * @returns A Builder instance for further configuration.
   */
  patch(...path: Path): Builder {
    return this.#build("PATCH", path);
  }

  /**
   * Initiates a DELETE request to the specified path.
   * @param path - The path segments to construct the URL.
   * @returns A BuilderWithoutBody instance for further configuration.
   */
  delete(...path: Path): BuilderWithoutBody {
    return this.#build("DELETE", path);
  }
}

type BuilderWithoutBody = Omit<Builder, "body">;
type BuilderOptions = Omit<Options, "baseUrl">;

class Builder {
  #body?: BodyInit;
  #headers = new Headers();
  #method: string;
  #options: BuilderOptions;
  #signal?: AbortSignal;
  #url: URL;

  constructor(method: string, url: URL, options: BuilderOptions) {
    this.#method = method;
    this.#url = url;
    this.#options = options;
  }

  /**
   * Sends the request and resolves with the response as an ArrayBuffer.
   * @returns A Promise that resolves with the response ArrayBuffer.
   */
  async arrayBuffer(): Promise<ArrayBuffer> {
    const response = await this.response();
    return response.arrayBuffer();
  }

  /**
   * Sends the request and resolves with the response as a Blob.
   * @returns A Promise that resolves with the response Blob.
   */
  async blob(): Promise<Blob> {
    const response = await this.response();
    return response.blob();
  }

  /**
   * Sets the body of the request.
   * @param value - The body to include in the request, such as JSON, string, Blob, or other supported types.
   * @returns The Builder instance for chaining.
   */
  body(value: JSONBody | BodyInit): this {
    const h = this.#headers;
    if (value instanceof ArrayBuffer) {
      this.#body = value;
      h.set("content-length", String(value.byteLength));
    } else if (value instanceof Blob) {
      this.#body = value;
      h.set("content-length", String(value.size));
      h.set("content-type", value.type || "application/octet-stream");
    } else if (value instanceof ReadableStream) {
      this.#body = value;
      // Content-Length for stream can't be set; it's indeterminate
    } else if (value instanceof FormData) {
      this.#body = value;
      // Content-Length for FormData can't be set; it's managed by the browser
    } else if (value instanceof URLSearchParams) {
      this.#body = value;
      h.set("content-type", "application/x-www-form-urlencoded;charset=utf-8");
    } else if (typeof value === "string") {
      this.#body = value;
      h.set("content-length", String(value.length));
      if (!h.has("content-type")) {
        h.set("content-type", "text/plain;charset=utf-8");
      }
    } else {
      const json = JSON.stringify(value);
      this.#body = json;
      h.set("content-length", String(json.length));
      if (!h.has("content-type")) {
        h.set("content-type", "application/json;charset=utf-8");
      }
    }
    return this;
  }

  /**
   * Sets the cache mode of the request.
   * @param value - The cache mode (e.g., "default", "no-store").
   * @returns The Builder instance for chaining.
   */
  cache(value: RequestCache): this {
    this.#options.cache = value;
    return this;
  }

  /**
   * Sets the credentials mode of the request.
   * @param value - The credentials mode (e.g., "include", "omit").
   * @returns The Builder instance for chaining.
   */
  credentials(value: RequestCredentials): this {
    this.#options.credentials = value;
    return this;
  }

  /**
   * Sends the request and resolves with the response as parsed HTML.
   * @param type - The expected MIME type (default is "text/html").
   * @returns A Promise that resolves with a parsed HTML Document.
   */
  async document(
    type: DOMParserSupportedType = "text/html"
  ): Promise<Document> {
    const text = await this.text();
    return new DOMParser().parseFromString(text, type);
  }

  /**
   * Sends the request and resolves with the response as FormData.
   * @returns A Promise that resolves with the response FormData.
   */
  async formData(): Promise<FormData> {
    const response = await this.response();
    return response.formData();
  }

  /**
   * Sets a header for the request.
   * @param key - The header name.
   * @param value - The header value.
   * @param append - Whether to append the value if the header already exists (default is false).
   * @returns The Builder instance for chaining.
   */
  header(key: string, value: string | number, append?: boolean): this {
    const h = this.#headers;
    const v = String(value);
    if (append) {
      h.append(key, v);
    } else {
      h.set(key, v);
    }
    return this;
  }

  /**
   * Sets multiple headers for the request.
   * @param init - An object or iterable to initialize headers.
   * @param append - Whether to append values if the headers already exist (default is false).
   * @returns The Builder instance for chaining.
   */
  headers(init: HeadersInit, append?: boolean): this {
    new Headers(init).forEach((value, key) => this.header(key, value, append));
    return this;
  }

  /**
   * Sets the integrity value for the request.
   * @param value - The integrity checksum (e.g., a Subresource Integrity hash).
   * @returns The Builder instance for chaining.
   */
  integrity(value: string): this {
    this.#options.integrity = value;
    return this;
  }

  /**
   * Sends the request and resolves with the response as parsed JSON.
   * @returns A Promise that resolves with the response parsed as a JSONValue.
   */
  async json(): Promise<JSONValue> {
    const response = await this.response();
    return response.json();
  }

  /**
   * Sets the keepalive option for the request.
   * @param value - Whether the request should persist beyond page unloads.
   * @returns The Builder instance for chaining.
   */
  keepalive(value = true): this {
    this.#options.keepalive = value;
    return this;
  }

  /**
   * Sets the request mode.
   * @param value - The request mode (e.g., "cors", "same-origin").
   * @returns The Builder instance for chaining.
   */
  mode(value: RequestMode): this {
    this.#options.mode = value;
    return this;
  }

  /**
   * Adds a URL parameter to the request.
   * @param key - The parameter name.
   * @param value - The parameter value.
   * @param append - Whether to append the value if the parameter already exists (default is false).
   * @returns The Builder instance for chaining.
   */
  param(key: string, value: string | number | boolean, append?: boolean): this {
    const p = this.#url.searchParams;
    const v = String(value);
    if (append) {
      p.append(key, v);
    } else {
      p.set(key, v);
    }
    return this;
  }

  /**
   * Adds multiple URL parameters to the request.
   * @param init - An object, string, or iterable to initialize parameters.
   * @param append - Whether to append values if the parameters already exist (default is false).
   * @returns The Builder instance for chaining.
   */
  params(init: URLSearchParamsInit, append?: boolean): this {
    new URLSearchParams(init).forEach((value, key) =>
      this.param(key, value, append)
    );
    return this;
  }

  /**
   * Sets the priority of the request.
   * @param value - The request priority (e.g., "high", "low").
   * @returns The Builder instance for chaining.
   */
  priority(value: RequestPriority): this {
    this.#options.priority = value;
    return this;
  }

  /**
   * Sets the redirect behavior for the request.
   * @param value - The redirect behavior (e.g., "follow", "error").
   * @returns The Builder instance for chaining.
   */
  redirect(value: RequestRedirect = "follow"): this {
    this.#options.redirect = value;
    return this;
  }

  /**
   * Sets the referrer for the request.
   * @param value - The referrer URL.
   * @returns The Builder instance for chaining.
   */
  referrer(value: string): this {
    this.#options.referrer = value;
    return this;
  }

  /**
   * Sets the referrer policy for the request.
   * @param value - The referrer policy (e.g., "no-referrer", "origin").
   * @returns The Builder instance for chaining.
   */
  referrerPolicy(value: ReferrerPolicy): this {
    this.#options.referrerPolicy = value;
    return this;
  }

  /**
   * Sends the request and resolves with the raw Response object.
   * @returns A Promise that resolves with the Response.
   */
  async response(): Promise<Response> {
    const {
      beforeSend,
      fetch = globalThis.fetch,
      timeout = 10_000,
      ...requestInit
    } = this.#options;

    const signal = mergeAbortSignals(
      AbortSignal.timeout(timeout),
      this.#signal
    );

    const request = new Request(this.#url, {
      ...requestInit,
      body: this.#body,
      headers: this.#headers,
      method: this.#method,
      signal,
    });

    await beforeSend?.(request);
    const response = await fetch(request);

    if (!response.ok) {
      throw new Error(`Server replied with status: ${response.status}`, {
        cause: response,
      });
    }

    return response;
  }

  /**
   * Sets an AbortSignal or AbortController to control request cancellation.
   * @param value - An AbortSignal or AbortController instance.
   * @returns The Builder instance for chaining.
   */
  signal(value: AbortController | AbortSignal): this {
    if (value instanceof AbortController) {
      this.#signal = value.signal;
    } else {
      this.#signal = value;
    }
    return this;
  }

  /**
   * Sends the request and resolves with the response body as a ReadableStream.
   * @returns A Promise that resolves with the response stream.
   */
  async stream(): Promise<ReadableStream<Uint8Array>> {
    const response = await this.response();
    return (
      response.body ??
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      })
    );
  }

  /**
   * Sends the request and resolves with the response as plain text.
   * @returns A Promise that resolves with the response text.
   */
  async text(): Promise<string> {
    const response = await this.response();
    return response.text();
  }

  /**
   * Sets the timeout duration for the request.
   * @param value - The timeout in milliseconds.
   * @returns The Builder instance for chaining.
   */
  timeout(value: number): this {
    this.#options.timeout = value;
    return this;
  }

  /**
   * Converts the current Builder configuration into a Request object.
   * @returns The constructed Request object.
   */
  toRequest(): Request {
    return new Request(this.#url, {
      ...this.#options,
      body: this.#body,
      headers: this.#headers,
      method: this.#method,
      signal: this.#signal,
    });
  }
}

function mergeAbortSignals(
  timeoutSignal: AbortSignal,
  userSignal?: AbortSignal
): AbortSignal {
  const controller = new AbortController();
  const { signal } = controller;

  const onAbort = () => controller.abort();

  // Handle the required timeout signal
  if (timeoutSignal.aborted) {
    controller.abort(); // Abort immediately if timeout signal is already aborted
  } else {
    timeoutSignal.addEventListener("abort", onAbort);
  }

  // Handle the optional user signal
  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(); // Abort immediately if user's signal is already aborted
    } else {
      userSignal.addEventListener("abort", onAbort);
    }
  }

  // Cleanup event listeners when the merged signal aborts
  signal.addEventListener("abort", () => {
    timeoutSignal.removeEventListener("abort", onAbort);
    if (userSignal) userSignal.removeEventListener("abort", onAbort);
  });

  return signal;
}
