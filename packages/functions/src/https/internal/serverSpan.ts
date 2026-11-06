/** @internal */
import { Context, Option, Tracer, type Exit } from "effect";
import { traceContext } from "firebase-functions/v2";

/**
 * The parent of a call's server span: the trace context `firebase-functions`
 * read from the request's headers, the `X-Cloud-Trace-Context` header winning
 * over `traceparent`. Read it synchronously at the start of the call, before
 * any fiber runs: Effect's scheduler may later run under another request's
 * async store. `undefined` when the request carried none, as in the emulator.
 *
 * @internal
 */
export const externalParent = (): Tracer.ExternalSpan | undefined => {
  const store = traceContext.getStore();
  if (store === undefined) return undefined;
  return Tracer.externalSpan({
    traceId: store.traceId,
    // The Cloud header's decimal span id reaches us as unpadded hex.
    spanId: store.parentId.padStart(16, "0"),
    sampled: store.sample,
  });
};

type SpanOptions = Parameters<Tracer.Tracer["span"]>[0];

/**
 * A span opened before the Tracer of `Live` is known. It records what happens
 * to it, and replays that onto the real span once {@link DeferredTracer.attach}
 * creates it. From then on it forwards everything.
 */
class DeferredSpan implements Tracer.Span {
  readonly _tag = "Span";
  readonly name: string;
  readonly parent: Option.Option<Tracer.AnySpan>;
  readonly annotations: Context.Context<never>;
  readonly kind: Tracer.SpanKind;
  readonly sampled: boolean;
  readonly options: SpanOptions;
  real: Tracer.Span | undefined;
  // What happened before `real` existed, in order.
  private readonly calls: Array<(span: Tracer.Span) => void> = [];
  private readonly pendingAttributes = new Map<string, unknown>();
  private readonly pendingLinks: Array<Tracer.SpanLink>;
  private pendingStatus: Tracer.SpanStatus;
  private provisional: { traceId: string; spanId: string } | undefined;

  constructor(options: SpanOptions) {
    this.options = options;
    this.name = options.name;
    this.parent = options.parent;
    this.annotations = options.annotations;
    this.kind = options.kind;
    this.sampled = options.sampled;
    this.pendingLinks = [...options.links];
    this.pendingStatus = { _tag: "Started", startTime: options.startTime };
  }

  // Read before `attach` only by a Tracer that `Live` provides to its own
  // Layers: such a span joins the trace, but its parent's span id is one no
  // exporter sees.
  private get ids() {
    if (this.provisional === undefined) {
      const native = new Tracer.NativeSpan({ ...this.options, links: [] });
      this.provisional = { traceId: native.traceId, spanId: native.spanId };
    }
    return this.provisional;
  }

  get traceId() {
    return this.real?.traceId ?? this.ids.traceId;
  }

  get spanId() {
    return this.real?.spanId ?? this.ids.spanId;
  }

  get status() {
    return this.real?.status ?? this.pendingStatus;
  }

  get attributes() {
    return this.real?.attributes ?? this.pendingAttributes;
  }

  get links() {
    return this.real?.links ?? this.pendingLinks;
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
    if (this.real !== undefined) return this.real.end(endTime, exit);
    if (this.pendingStatus._tag === "Ended") return;
    this.pendingStatus = { _tag: "Ended", startTime: this.pendingStatus.startTime, endTime, exit };
  }

  attribute(key: string, value: unknown) {
    if (this.real !== undefined) return this.real.attribute(key, value);
    this.pendingAttributes.set(key, value);
  }

  event(name: string, startTime: bigint, attributes?: Record<string, unknown>) {
    if (this.real !== undefined) return this.real.event(name, startTime, attributes);
    this.calls.push((span) => span.event(name, startTime, attributes));
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>) {
    if (this.real !== undefined) return this.real.addLinks(links);
    this.calls.push((span) => span.addLinks(links));
  }

  /** Opens the real span on `tracer` and replays onto it what happened so far. */
  attach(tracer: Tracer.Tracer) {
    const parent = Option.map(this.parent, (parent) =>
      parent instanceof DeferredSpan ? (parent.real ?? parent) : parent,
    );
    const real = tracer.span({ ...this.options, parent, links: this.pendingLinks });
    for (const [key, value] of this.pendingAttributes) real.attribute(key, value);
    for (const call of this.calls) call(real);
    if (this.pendingStatus._tag === "Ended") {
      real.end(this.pendingStatus.endTime, this.pendingStatus.exit);
    }
    this.real = real;
  }
}

/**
 * The Tracer a call starts under. A call's server span opens before `Live` is
 * built, and so before its Tracer is known, so that a first call's Layer
 * build nests under it. This Tracer defers the spans opened until then, and
 * {@link DeferredTracer.attach} hands them to the Tracer of `Live`, which
 * exports them with their original times and parents.
 *
 * @internal
 */
export class DeferredTracer {
  private readonly deferred: Array<DeferredSpan> = [];
  private real: Tracer.Tracer | undefined;

  readonly tracer: Tracer.Tracer = Tracer.make({
    span: (options) => {
      if (this.real !== undefined) return this.real.span(options);
      const span = new DeferredSpan(options);
      this.deferred.push(span);
      return span;
    },
  });

  /**
   * Hands every span opened so far to the Tracer that `services` provide, the
   * native one when they provide none, in the order they were opened, so that
   * each parent exists before its children.
   */
  attach(services: Context.Context<never>) {
    if (this.real !== undefined) return;
    this.real = Context.get(services, Tracer.Tracer);
    for (const span of this.deferred) span.attach(this.real);
    this.deferred.length = 0;
  }
}
