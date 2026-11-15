import { z } from 'zod';

const strictObject = (schema: z.AnyZodObject): z.AnyZodObject => {
  const shape = Object.fromEntries(
    Object.entries<z.ZodTypeAny>(schema.shape).map(([key, value]) => [key, strictTwin(value)]),
  );
  const rebuilt = new z.ZodObject({ ...schema._def, shape: () => shape });
  const tolerantByDesign = schema._def.unknownKeys === 'passthrough' || !(schema._def.catchall instanceof z.ZodNever);
  return tolerantByDesign ? rebuilt : rebuilt.strict();
};

const strictUnion = (schema: z.ZodUnion<z.ZodUnionOptions>): z.ZodTypeAny => {
  const [first, ...rest] = schema.options.map(strictTwin);
  return first === undefined ? schema : new z.ZodUnion({ ...schema._def, options: [first, ...rest] });
};

const strictDiscriminatedUnion = (
  schema: z.ZodDiscriminatedUnion<string, z.ZodDiscriminatedUnionOption<string>[]>,
): z.ZodTypeAny => new z.ZodDiscriminatedUnion({
  ...schema._def,
  options: schema.options.map(strictObject),
  optionsMap: new Map([...schema.optionsMap].map(([value, option]) => [value, strictObject(option)])),
});

const strictTwin = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  if (schema instanceof z.ZodObject) return strictObject(schema);
  if (schema instanceof z.ZodArray) return new z.ZodArray({ ...schema._def, type: strictTwin(schema.element) });
  if (schema instanceof z.ZodOptional) return new z.ZodOptional({ ...schema._def, innerType: strictTwin(schema.unwrap()) });
  if (schema instanceof z.ZodNullable) return new z.ZodNullable({ ...schema._def, innerType: strictTwin(schema.unwrap()) });
  if (schema instanceof z.ZodDefault) return new z.ZodDefault({ ...schema._def, innerType: strictTwin(schema.removeDefault()) });
  if (schema instanceof z.ZodReadonly) return new z.ZodReadonly({ ...schema._def, innerType: strictTwin(schema.unwrap()) });
  if (schema instanceof z.ZodBranded) return new z.ZodBranded({ ...schema._def, type: strictTwin(schema.unwrap()) });
  if (schema instanceof z.ZodEffects) return new z.ZodEffects({ ...schema._def, schema: strictTwin(schema.innerType()) });
  if (schema instanceof z.ZodLazy) return new z.ZodLazy({ ...schema._def, getter: () => strictTwin(schema.schema) });
  if (schema instanceof z.ZodPipeline) return new z.ZodPipeline({ ...schema._def, in: strictTwin(schema._def.in) });
  if (schema instanceof z.ZodUnion) return strictUnion(schema);
  if (schema instanceof z.ZodDiscriminatedUnion) return strictDiscriminatedUnion(schema);
  if (schema instanceof z.ZodIntersection) {
    return new z.ZodIntersection({ ...schema._def, left: strictTwin(schema._def.left), right: strictTwin(schema._def.right) });
  }
  if (schema instanceof z.ZodRecord) return new z.ZodRecord({ ...schema._def, valueType: strictTwin(schema.valueSchema) });
  return schema;
};

/**
 * Rejects unknown fields at every nesting level while parsing exactly like `schema`, so a misspelt field fails
 * validation instead of being dropped. The original schema is left untouched for callers that tolerate extras.
 */
export const strictInput = <T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> => {
  const twin = strictTwin(schema);
  return new z.ZodEffects<T>({
    schema,
    typeName: z.ZodFirstPartyTypeKind.ZodEffects,
    effect: {
      type: 'preprocess',
      transform: (raw, ctx) => {
        const strict = twin.safeParse(raw);
        if (strict.success) return raw;
        const otherwiseValid = schema.safeParse(raw).success;
        for (const issue of strict.error.issues) {
          if (otherwiseValid || issue.code === z.ZodIssueCode.unrecognized_keys) ctx.addIssue(issue);
        }
        return raw;
      },
    },
  });
};
