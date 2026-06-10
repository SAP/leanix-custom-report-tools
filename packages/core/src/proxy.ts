import { ProxyAgent, setGlobalDispatcher } from 'undici';

// Applies to all outgoing requests, including Node's native fetch.
// https://github.com/nodejs/undici#undicisetglobaldispatcherdispatcher
export function initProxy(proxyURL?: string): void {
  if (proxyURL) setGlobalDispatcher(new ProxyAgent(proxyURL));
}
