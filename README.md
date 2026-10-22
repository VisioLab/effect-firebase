# Vite+ Monorepo Starter

A starter for creating a Vite+ monorepo.

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the tests. The Admin and client SDKs' tests talk to the Firestore emulator, which
  needs Java 21 or later and has to be running first, in a terminal of its own:

```bash
vp run emulator
vp run -r test
```

- Build the monorepo:

```bash
vp run -r build
```

- Run the development server:

```bash
vp run dev
```
