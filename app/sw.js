import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";

// `self.__SW_MANIFEST` is injected by @serwist/next at build time with the
// list of build assets to precache.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
