import { installMessageRouter } from '../background/router/dispatch';
import { initIdleLock } from '../background/settings/idleLock';

export default defineBackground(() => {
  installMessageRouter();
  initIdleLock();
});
