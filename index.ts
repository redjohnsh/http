import type { output, ZodType } from "zod";
import {
	type GenericSchema,
	type InferOutput,
	safeParseAsync as vParse,
} from "valibot";
import type { Banditype } from "banditypes";
import { type Struct, assert } from "superstruct";
import { decode } from "@msgpack/msgpack";

export type Success<T> = { readonly success: true; value: T };
export type Failure<E> = { readonly success: false; reason: E };
export type Result<T, E> = Success<T> | Failure<E>;

type JSONValue =
	| string
	| number
	| boolean
	| null
	| { [x: string]: JSONValue }
	| Array<JSONValue>;

export type HttpServerError = {
	type: "SERVER_ERROR";
	response: Response;
};

export type HttpClientError = {
	type: "CLIENT_ERROR";
	message: string;
};

export type HttpError = HttpServerError | HttpClientError;

function success<T>(value: T): Success<T> {
	return { success: true, value };
}

function failure<E>(reason: E): Failure<E> {
	return { success: false, reason };
}

function clientError(message: string): HttpClientError {
	return { type: "CLIENT_ERROR", message };
}

function serverError(response: Response): HttpServerError {
	return { type: "SERVER_ERROR", response };
}

export interface Adapter<T> {
	parse(input: unknown): Result<T, string> | Promise<Result<T, string>>;
}

export function zAdapter<T extends ZodType>(schema: T): Adapter<output<T>> {
	return {
		async parse(input) {
			const result = await schema.safeParseAsync(input);
			if (result.success) {
				return success(result.data);
			}
			return failure(result.error.message);
		},
	};
}

export function vAdapter<T extends GenericSchema>(
	schema: T,
): Adapter<InferOutput<T>> {
	return {
		async parse(input) {
			const result = await vParse(schema, input);
			if (result.success) {
				return success(result.output);
			}
			return failure(result.issues[0].message);
		},
	};
}

export function bAdapter<T>(schema: Banditype<T>): Adapter<T> {
	return {
		parse(input) {
			try {
				return success(schema(input));
			} catch (err) {
				if (err instanceof Error) {
					return failure(err.message);
				}
				return failure("Could not parse data using banditypes");
			}
		},
	};
}

export function sAdapter<T>(schema: Struct<T>): Adapter<T> {
	return {
		parse(input) {
			try {
				assert(input, schema);
				return success(input);
			} catch (err) {
				if (err instanceof Error) {
					return failure(err.message);
				}
				return failure("Could not parse data using superstruct");
			}
		},
	};
}

type Fetch = typeof globalThis.fetch;

interface TimeoutOptions {
	retries?: number;
	retryDelay?: number;
	timeout?: number;
}

interface RequestInitOptions
	extends Omit<
		RequestInit,
		"body" | "headers" | "method" | "signal" | "window"
	> {}

export type HttpResult<T> = Promise<Result<T, HttpError>>;

export interface HttpClientOptions extends TimeoutOptions, RequestInitOptions {
	baseUrl?: string;
	fetch?: Fetch;
	headers?: HeadersInit | ((headers: Headers) => void);
}

interface RequestContext
	extends Omit<HttpClientOptions, "baseUrl" | "headers"> {
	body?: BodyInit;
	headers: Headers;
	method: string;
	signal?: AbortSignal;
	url: URL;
}

type Path = readonly (number | string)[];

export class HttpClient {
	#options: HttpClientOptions;

	constructor(options: HttpClientOptions = {}) {
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

	#build(method: string, path: Path): RequestBuilder {
		const { baseUrl, ...options } = this.#options;
		const pathname = this.#pathname(path);
		const url = new URL(pathname, baseUrl);
		let headers: Headers;
		if (typeof this.#options.headers === "function") {
			headers = new Headers();
			this.#options.headers(headers);
		} else {
			headers = new Headers();
		}
		return new RequestBuilder({ ...options, headers, method, url });
	}

	get(...path: Path): RequestBuilderWithoutBody {
		return this.#build("GET", path);
	}

	post(...path: Path): RequestBuilder {
		return this.#build("POST", path);
	}

	put(...path: Path): RequestBuilder {
		return this.#build("PUT", path);
	}

	patch(...path: Path): RequestBuilder {
		return this.#build("PATCH", path);
	}

	delete(...path: Path): RequestBuilderWithoutBody {
		return this.#build("DELETE", path);
	}
}

export class Http {
	private constructor() {}

	static readonly instance: HttpClient = new HttpClient();

	static get(...path: Path): RequestBuilderWithoutBody {
		return Http.instance.get(...path);
	}

	static post(...path: Path): RequestBuilder {
		return Http.instance.post(...path);
	}

	static put(...path: Path): RequestBuilder {
		return Http.instance.put(...path);
	}

	static patch(...path: Path): RequestBuilder {
		return Http.instance.patch(...path);
	}

	static delete(...path: Path): RequestBuilderWithoutBody {
		return Http.instance.delete(...path);
	}
}

type RequestBuilderWithoutBody = Omit<RequestBuilder, "body">;

class RequestBuilder {
	#context: RequestContext;

	constructor(context: RequestContext) {
		this.#context = context;
	}

	arrayBuffer(): HttpResult<ArrayBuffer> {
		return this.build().arrayBuffer();
	}

	blob(): HttpResult<Blob> {
		return this.build().blob();
	}

	body(value: JSONValue | BodyInit): this {
		const h = this.#context.headers;
		if (value instanceof ArrayBuffer) {
			this.#context.body = value;
			h.set("content-length", String(value.byteLength));
		} else if (value instanceof Blob) {
			this.#context.body = value;
			h.set("content-length", String(value.size));
			h.set("content-type", value.type || "application/octet-stream");
		} else if (value instanceof ReadableStream) {
			this.#context.body = value;
			// Content-Length for stream can't be set; it's indeterminate
		} else if (value instanceof FormData) {
			this.#context.body = value;
			// Content-Length for FormData can't be set; it's managed by the browser
		} else if (value instanceof URLSearchParams) {
			this.#context.body = value;
			h.set("content-type", "application/x-www-form-urlencoded;charset=utf-8");
		} else if (typeof value === "string") {
			this.#context.body = value;
			h.set("content-length", String(value.length));
			if (!h.has("content-type")) {
				h.set("content-type", "text/plain;charset=utf-8");
			}
		} else {
			const json = JSON.stringify(value);
			this.#context.body = json;
			h.set("content-length", String(json.length));
			if (!h.has("content-type")) {
				h.set("content-type", "application/json;charset=utf-8");
			}
		}
		return this;
	}

	build(): ResponseBuilder {
		return new ResponseBuilder(this.#context);
	}

	cache(value: RequestCache): this {
		this.#context.cache = value;
		return this;
	}

	credentials(value: RequestCredentials): this {
		this.#context.credentials = value;
		return this;
	}

	formData(): HttpResult<FormData> {
		return this.build().formData();
	}

	header(key: string, value: string | number, append?: boolean): this {
		const h = this.#context.headers;
		const v = String(value);
		if (append) {
			h.append(key, v);
		} else {
			h.set(key, v);
		}
		return this;
	}

	headers(values: { [key: string]: string | number }, append?: boolean): this {
		for (const [key, value] of Object.entries(values)) {
			this.header(key, value, append);
		}
		return this;
	}

	integrity(value: string): this {
		this.#context.integrity = value;
		return this;
	}

	keepalive(value = true): this {
		this.#context.keepalive = value;
		return this;
	}

	mode(value: RequestMode): this {
		this.#context.mode = value;
		return this;
	}

	param(key: string, value: string | number, append?: boolean): this {
		const p = this.#context.url.searchParams;
		const v = String(value);
		if (append) {
			p.append(key, v);
		} else {
			p.set(key, v);
		}
		return this;
	}

	params(values: { [key: string]: string | number }, append?: boolean): this {
		for (const [key, value] of Object.entries(values)) {
			this.param(key, value, append);
		}
		return this;
	}

	priority(value: RequestPriority): this {
		this.#context.priority = value;
		return this;
	}

	redirect(value: RequestRedirect = "follow"): this {
		this.#context.redirect = value;
		return this;
	}

	referrer(value: string): this {
		this.#context.referrer = value;
		return this;
	}

	referrerPolicy(value: ReferrerPolicy): this {
		this.#context.referrerPolicy = value;
		return this;
	}

	retries(value: number): this {
		this.#context.retries = value;
		return this;
	}

	retryDelay(value: number): this {
		this.#context.retryDelay = value;
		return this;
	}

	response(): HttpResult<Response> {
		return this.build().response();
	}

	signal(value: AbortController | AbortSignal): this {
		if (value instanceof AbortController) {
			this.#context.signal = value.signal;
		} else {
			this.#context.signal = value;
		}
		return this;
	}

	stream(): HttpResult<ReadableStream<Uint8Array>> {
		return this.build().stream();
	}

	text(): HttpResult<string> {
		return this.build().text();
	}

	timeout(value: number): this {
		this.#context.timeout = value;
		return this;
	}

	unsafeJson(): HttpResult<JSONValue> {
		return this.build().unsafeJson();
	}
}

class ResponseBuilder {
	#context: RequestContext;

	constructor(context: RequestContext) {
		this.#context = context;
	}

	async response(): HttpResult<Response> {
		return tryRequest(this.#context);
	}

	async arrayBuffer(): HttpResult<ArrayBuffer> {
		const result = await this.response();
		if (!result.success) return result;
		try {
			return success(await result.value.arrayBuffer());
		} catch {
			return failure(clientError("Could not parse response as `ArrayBuffer`"));
		}
	}

	async blob(): HttpResult<Blob> {
		const result = await this.response();
		if (!result.success) return result;
		try {
			return success(await result.value.blob());
		} catch {
			return failure(clientError("Could not parse response as `Blob`"));
		}
	}

	async formData(): HttpResult<FormData> {
		const result = await this.response();
		if (!result.success) return result;
		try {
			return success(await result.value.formData());
		} catch {
			return failure(clientError("Clould not parse response as `FormData`"));
		}
	}

	async json<T>(adapter: Adapter<T>): HttpResult<T> {
		const r1 = await this.unsafeJson();
		if (!r1.success) return r1;
		const r2 = await adapter.parse(r1.value);
		if (!r2.success) return failure(clientError(r2.reason));
		return success(r2.value);
	}

	async msgpack<T>(adapter: Adapter<T>): HttpResult<T> {
		const r1 = await this.unsafeMsgPack();
		if (!r1.success) return r1;
		const r2 = await adapter.parse(r1.value);
		if (!r2.success) return failure(clientError(r2.reason));
		return success(r2.value);
	}

	async stream(): HttpResult<ReadableStream<Uint8Array>> {
		const result = await this.response();
		if (!result.success) return result;
		const stream =
			result.value.body ??
			new ReadableStream({
				start(controller) {
					controller.close();
				},
			});
		return success(stream);
	}

	async text(): HttpResult<string> {
		const result = await this.response();
		if (!result.success) return result;
		try {
			return success(await result.value.text());
		} catch {
			return failure(clientError("Could not parse response as `text`"));
		}
	}

	async unsafeJson(): HttpResult<JSONValue> {
		const result = await this.response();
		if (!result.success) return result;
		try {
			return success(await result.value.json());
		} catch {
			return failure(clientError("Could not parse response as `JSON`"));
		}
	}

	async unsafeMsgPack(): HttpResult<JSONValue> {
		const r1 = await this.arrayBuffer();
		if (!r1.success) return r1;
		try {
			return success(decode(r1.value) as JSONValue);
		} catch (err) {
			return failure(clientError("Could not parse response as `MsgPack`"));
		}
	}
}

const TIMEOUT_MESSAGE = "Request timed out";

async function tryRequest(
	context: RequestContext,
	currentAttempt = 1,
): HttpResult<Response> {
	const {
		fetch = globalThis.fetch,
		retries = 1,
		retryDelay = 1000,
		signal: userSignal,
		timeout = 10000,
		url,
		...init
	} = context;

	const timeoutController = new AbortController();
	const availableSignals = [timeoutController.signal];

	if (userSignal) {
		availableSignals.push(userSignal);
	}

	// Dispatch a timeout to abort request
	const timeoutId = setTimeout(
		() => timeoutController.abort(TIMEOUT_MESSAGE),
		timeout,
	);

	// Merge our signal with the user's signal
	const mergedSignal = mergeSignals(availableSignals);

	// Create request
	const request = new Request(url, {
		...init,
		signal: mergedSignal,
	});

	try {
		const response = await fetch(request);
		if (!response.ok) {
			return failure(serverError(response));
		}
		return success(response);
	} catch (err) {
		if (typeof err === "string") {
			if (err.includes(TIMEOUT_MESSAGE)) {
				if (currentAttempt < retries) {
					await delay(retryDelay * 2 ** currentAttempt);
					return await tryRequest(context, currentAttempt + 1);
				}
				return failure(clientError(TIMEOUT_MESSAGE));
			}
			return failure(clientError(`Request was aborted: ${err}`));
		}

		if (err instanceof DOMException && err.name === "AbortError") {
			// Return specific abort error for DOMException
			return failure(clientError(err.message));
		}

		if (err instanceof TypeError && err.message.includes("Failed to fetch.")) {
			// Retry the request if retries are available
			if (currentAttempt < retries) {
				await delay(retryDelay * 2 ** currentAttempt);
				return await tryRequest(context, currentAttempt + 1);
			}
			// Return connection error if no retries are left
			return failure(clientError("Network error."));
		}

		return failure(clientError("Unknown error."));
	} finally {
		clearTimeout(timeoutId);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function mergeSignals(signals: readonly AbortSignal[]): AbortSignal {
	const controller = new AbortController();

	const onAbort = (ev: Event) => {
		if (ev.target instanceof AbortSignal) {
			controller.abort(ev.target.reason);
		} else {
			controller.abort();
		}
	};

	const cleanup = () => {
		for (const signal of signals) {
			signal.removeEventListener("abort", onAbort);
		}
	};

	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
		} else {
			signal.addEventListener("abort", onAbort, { once: true });
		}
	}

	if (controller.signal.aborted) {
		cleanup();
	} else {
		controller.signal.addEventListener("abort", cleanup, { once: true });
	}

	return controller.signal;
}
