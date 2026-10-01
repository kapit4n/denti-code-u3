/**
 * Public surface of the Denti-Code U3 API client.
 *
 * Features import from `@denti-code-u3/api-client` and build their own typed
 * resource functions on top of `ApiClient`.
 */

export {
  API_ERROR_CODES,
  ApiClient,
  ApiClientError,
  buildQueryString,
  toApiClientError,
  type ApiClientOptions,
  type ApiErrorCode,
  type QueryValue,
  type RequestOptions,
} from './http.js';
