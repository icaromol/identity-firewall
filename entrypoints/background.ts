import { installMessageRouter } from '../background/router/dispatch';

export default defineBackground(() => {
  installMessageRouter();
});
