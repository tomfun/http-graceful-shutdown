// tslint:disable interface-name

declare namespace Mocha {
  interface IHookCallbackContext {
    timeout(): number;
    timeout(ms: number): this;
  }
}
