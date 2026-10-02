/**
 * Whatever the model put in a tool call.
 *
 * Its own type so every parser in analysis-tools starts from the same
 * honest shape: an object of unknowns that has been through JSON and
 * nothing more. The schema is sent to the model, not enforced on the way
 * back — a tool argument is input, and the parsers treat it as such.
 */
export type ToolInput = Record<string, unknown>;
