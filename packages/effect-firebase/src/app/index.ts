import { Context } from "effect";

export interface App {
  name: string;
  projectId: string;
}

export const App = Context.Service<App>("~effect-firebase/App");
