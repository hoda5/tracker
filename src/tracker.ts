/////////////////////////////////////////////////
// adapted from http://docs.meteor.com/#tracker //
/////////////////////////////////////////////////

import * as React from "react";
import "@hoda5/extensions";
import { h5debug } from "@hoda5/h5debug";

export interface IRunOptions {
  finishSynchronously?: boolean;
}
export interface IComputationOptions {
  onError?: (error: Error) => void;
}

// tslint:disable-next-line:variable-name
const Tracker = {
  active: false,
  currentComputation: null as any as Computation,
  flush() {
    Tracker._runFlush({
      finishSynchronously: true,
    });
  },
  inFlush() {
    return inFlush;
  },
  _runFlush(options: IRunOptions) {
    if (Tracker.inFlush()) {
      throw new Error("Can't call Tracker.flush while flushing");
    }

    if (inCompute) {
      throw new Error("Can't flush inside Tracker.autorun");
    }

    options = options || {};

    inFlush = true;
    willFlush = true;

    let recomputedCount = 0;
    let finishedTry = false;
    try {
      while (pendingComputations.length ||
        afterFlushCallbacks.length) {

        while (pendingComputations.length) {
          const comp = pendingComputations.shift();
          if (comp) {
            comp._recompute();
            if (comp._needsRecompute()) {
              pendingComputations.unshift(comp);
            }
          }

          if (!options.finishSynchronously && ++recomputedCount > 1000) {
            finishedTry = true;
            return;
          }
        }

        if (afterFlushCallbacks.length) {
          const func = afterFlushCallbacks.shift();
          if (func) {
            try {
              func();
            } catch (e) {
              //
            }
          }
        }
      }
      finishedTry = true;
    } finally {
      if (!finishedTry) {
        inFlush = false;
        Tracker._runFlush({
          finishSynchronously: options.finishSynchronously,
        });
      }
      willFlush = false;
      inFlush = false;
      if (pendingComputations.length || afterFlushCallbacks.length) {
        if (options.finishSynchronously) {
          // tslint:disable-next-line
          throw new Error("still have more to do?");  // shouldn't happen
        }
        setTimeout(requireFlush, 10);
      }
    }
  },
  autorun(h5debugname: string, f: (comp: Computation) => void, options?: IComputationOptions) {

    if (typeof f !== "function") {
      throw new Error("Tracker.autorun requires a function argument");
    }

    options = options || {};

    const c = new Computation(
      h5debugname, f, Tracker.currentComputation, options.onError);

    if (Tracker.active) {
      Tracker.onInvalidate(() => {
        c.stop();
      });
    }

    return c;
  },
  nonreactive<T>(f: () => T): T {
    const previous = Tracker.currentComputation;
    setCurrentComputation(null as any);
    try {
      return f();
    } finally {
      setCurrentComputation(previous);
    }
  },
  onInvalidate(f: () => void) {
    if (!Tracker.active) {
      throw new Error("Tracker.onInvalidate requires a currentComputation");
    }

    Tracker.currentComputation.onInvalidate(f);
  },
  afterFlush(f: () => void) {
    afterFlushCallbacks.push(f);
    requireFlush();
  },
};

let nextId = 1;
const pendingComputations: Computation[] = [];
let willFlush = false;
let inFlush = false;
let inCompute = false;
const afterFlushCallbacks: Array<() => void> = [];

function setCurrentComputation(c: Computation) {
  Tracker.currentComputation = c;
  Tracker.active = !!c;
}

function requireFlush() {
  if (!willFlush) {
    // eslint-disable-next-line
    setTimeout(Tracker._runFlush, 0);
    willFlush = true;
  }
}

export class Computation {
  public stopped: boolean;
  public invalidated: boolean;
  public firstRun: boolean;
  public id: number;
  public parent: Computation;
  private onInvalidateCallbacks: Array<(comp: Computation) => void>;
  private onStopCallbacks: Array<(comp: Computation) => void>;
  private func: (comp: Computation) => void;
  private onError?: (error: Error) => void;
  private recomputing: boolean;

  constructor(
    h5debugname: string,
    f: (comp: Computation) => void,
    parent: Computation,
    onError?: (error: Error) => void) {
    (this as any).h5debugname = h5debugname;
    if (h5debug["@hoda5/tracker"]) {
      if (typeof h5debugname !== "string") throw new Error("autorun precisa de um nome");
    }
    this.stopped = false;
    this.invalidated = false;
    this.firstRun = true;

    this.id = nextId++;
    this.onInvalidateCallbacks = [];
    this.onStopCallbacks = [];
    this.parent = parent;
    this.func = f;
    this.onError = onError;
    this.recomputing = false;

    let errored = true;
    try {
      this._compute();
      errored = false;
    } finally {
      this.firstRun = false;
      if (errored) {
        this.stop();
      }
    }
  }

  public onInvalidate(f: (comp: Computation) => void) {
    if (typeof f !== "function") {
      throw new Error("onInvalidate requires a function");
    }

    if (this.invalidated) {
      Tracker.nonreactive(() => f(this));
    } else {
      this.onInvalidateCallbacks.push(f);
    }
  }

  public onStop(f: (comp: Computation) => void) {
    if (typeof f !== "function") {
      throw new Error("onStop requires a function");
    }

    if (this.stopped) {
      Tracker.nonreactive(() => f(this));
    } else {
      this.onStopCallbacks.push(f);
    }
  }

  public invalidate() {
    if (!this.invalidated) {
      if (!this.recomputing && !this.stopped) {
        requireFlush();
        pendingComputations.push(this);
      }

      this.invalidated = true;
      // tslint:disable-next-line
      for (let i = 0, f: (comp: Computation) => void; f = this.onInvalidateCallbacks[i]; i++) {
        Tracker.nonreactive(() => f(this));
      }
      this.onInvalidateCallbacks = [];
    }
  }

  public stop() {
    if (!this.stopped) {
      this.stopped = true;
      this.invalidate();
      // tslint:disable-next-line
      for (let i = 0, f: (comp: Computation) => void; f = this.onStopCallbacks[i]; i++) {
        Tracker.nonreactive(() => f(this));
      }
      this.onStopCallbacks = [];
    }
  }

  public _compute() {
    this.invalidated = false;

    const previous = Tracker.currentComputation;
    setCurrentComputation(this);
    const previousInCompute = inCompute;
    inCompute = true;
    try {
      this.func(this);
    } finally {
      setCurrentComputation(previous);
      inCompute = previousInCompute;
    }
  }

  public _needsRecompute() {
    return this.invalidated && !this.stopped;
  }

  public _recompute() {
    this.recomputing = true;
    try {
      if (this._needsRecompute()) {
        try {
          this._compute();
        } catch (e) {
          if (this.onError) {
            this.onError(e);
          }
        }
      }
    } finally {
      this.recomputing = false;
    }
  }

  public flush() {
    if (this.recomputing) {
      return;
    }

    this._recompute();
  }

  public run() {
    this.invalidate();
    this.flush();
  }
}

// tslint:disable-next-line
export class Dependency<T extends object={}> {
  public dependentsById: {
    [name: string]: Computation,
  };
  constructor(h5debugname: string, initialvalue?: T) {
    this.dependentsById = Object.create(null);
    (this as any).h5debugname = h5debugname;
    if (initialvalue) (this as any)._value = initialvalue;
    if (h5debug["@hoda5/tracker"]) {
      if (typeof h5debugname !== "string") throw new Error("Dependency precisa de um nome");
    }
  }

  public depend(computation?: Computation) {
    if (!computation) {
      if (!Tracker.active) {
        return false;
      }

      computation = Tracker.currentComputation;
    }
    const id = computation.id;
    if (h5debug["@hoda5/tracker"]) {
      h5debug["@hoda5/tracker"](
        (this as any).h5debugname, ".depend() on ", (computation as any).h5debugname,
      );
    }

    if (!(id in this.dependentsById)) {
      this.dependentsById[id] = computation;
      computation.onInvalidate(() => {
        delete this.dependentsById[id];
      });
      return true;
    }
    return false;
  }

  get value(): T {
    this.depend();
    return (this as any)._value;
  }

  set value(value: T) {
    // if (Object.prototype.compareObj.call((this as any)._value, value) !== 0) {
    (this as any)._value = value;
    this.changed();
    // }
  }

  public changed() {
    // tslint:disable-next-line
    for (const id in this.dependentsById) {
      if (h5debug["@hoda5/tracker"]) {
        const computation = this.dependentsById[id];
        h5debug["@hoda5/tracker"](
          (this as any).h5debugname, ".changed() invalidating ", (computation as any).h5debugname,
        );
      }
      this.dependentsById[id].invalidate();
    }
  }

  public hasDependents() {
    // tslint:disable-next-line
    for (const id in this.dependentsById) {
      return id !== undefined;
    }
    return false;
  }

  public waitForNextChange(timeout?: number): Promise<void>;
  public waitForNextChange(condition: () => boolean, timeout?: number): Promise<void>;
  public waitForNextChange(a?: any, b?: any): Promise<void> {
    const condition: () => boolean = typeof a === "function" ? a : undefined;
    const timeout: number = condition ? b : a;
    const err = new Error("timeout");
    return new Promise((resolve, reject) => {
      const tm = timeout && setTimeout(() => {
        reject(err);
        comp.stop();
      }, timeout);
      const comp = autorun((this as any).h5debugname + ".waitForNextChange", (icomp) => {
        this.depend();
        if (!icomp.firstRun) {
          if (tm) {
            clearTimeout(tm);
          }
          if (condition && (!condition())) return;
          resolve();
          icomp.stop();
        }
      });
    });
  }

  public ignoreNextChanges(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const tm = timeout && setTimeout(() => {
        comp.stop();
        resolve();
      }, timeout);
      const comp = autorun((this as any).h5debugname + ".ignoreNextChanges", (icomp) => {
        this.depend();
      });
    });
  }
}

export function reactProvider(
  h5debugname: string,
  Component: React.ComponentType<{}>,
  dependencies: Array<Dependency<any>>) {

  const depProv = new Dependency(h5debugname);

  // tslint:disable-next-line:max-classes-per-file
  class ReactProviderComp extends React.Component<{}, {}, {}> {
    private comp: Computation;
    public componentWillMount() {
      this.comp = autorun(h5debugname + ".rx", (c) => {
        depProv.depend();
        dependencies.forEach((dep) => dep.depend());
        if (!c.firstRun) nonreactive(() => this.setState({}));
      });
    }
    public componentWillUnmount() {
      if (this.comp) this.comp.stop();
    }
    public render() {
      return React.createElement(ErrorBoundary, null,
        React.createElement(Component));
    }
  }

  return {
    dependencies: {
      get list() {
        depProv.depend();
        return dependencies;
      },
      add(dependency: Dependency) {
        const i = dependencies.indexOf(dependency);
        if (i === -1) {
          dependencies.push(dependency);
          depProv.changed();
        }
      },
      remove(dependency: Dependency) {
        const i = dependencies.indexOf(dependency);
        if (i !== -1) {
          dependencies.splice(i, 1);
          depProv.changed();
        }
      },
    },
    render: ReactProviderComp as React.ComponentType<{}>,
  };
}

/**
 * @callback Tracker.ComputationFunction
 * @param {Tracker.Computation}
 */
/**
 * @summary Run a function now and rerun it later whenever its dependencies
 * change. Returns a Computation object that can be used to stop or observe the
 * rerunning.
 * @locus Client
 * @param {Tracker.ComputationFunction} runFunc The function to run. It receives
 * one argument: the Computation object that will be returned.
 * @param {Object} [options]
 * @param {Function} options.onError Optional. The function to run when an error
 * happens in the Computation. The only argument it receives is the Error
 * thrown. Defaults to the error being logged to the console.
 * @returns {Tracker.Computation}
 */

export function autorun(h5debugname: string, f: (comp: Computation) => void, options?: IComputationOptions) {
  return Tracker.autorun(h5debugname, f, options);
}

export function flush() {
  Tracker.flush();
}

export function nonreactive<T>(f: () => T): T {
  return Tracker.nonreactive(f);
}

export function afterFlush(f: () => void): void {
  return Tracker.afterFlush(f);
}

// tslint:disable-next-line:max-classes-per-file
class ErrorBoundary extends React.Component<{}, { hasError: false | string }> {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  public componentDidCatch(error, info) {
    this.setState({
      hasError: JSON.stringify({
        info,
        error: error.stack ? error.stack.toString() : error.message,
      }, null, 2).replace(/\\n/g, "\n"),
    });
  }

  public render() {
    if (this.state.hasError) return React.createElement("pre", null, this.state.hasError);
    return this.props.children;
  }
}
