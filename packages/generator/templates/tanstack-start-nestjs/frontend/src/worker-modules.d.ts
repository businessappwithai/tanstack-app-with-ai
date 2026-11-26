/** Vite's `?worker` imports, which Monaco's editor and language workers use. */
declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

/** The help pages, imported as text. */
declare module "*.md?raw" {
  const text: string;
  export default text;
}
