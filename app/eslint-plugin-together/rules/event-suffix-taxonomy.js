const SUFFIXES = [
  'Requested',
  'Confirmed',
  'Cancelled',
  'Changed',
  'Selected',
  'Opened',
  'Closed',
  'Added',
  'Moved',
  'Removed',
  'Failed',
  'Succeeded',
];

const keyName = (key) => {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return null;
};

const stringLiteralValue = (node) => {
  if (
    node &&
    node.type === 'TSLiteralType' &&
    node.literal &&
    node.literal.type === 'Literal' &&
    typeof node.literal.value === 'string'
  ) {
    return { name: node.literal.value, node };
  }
  return null;
};

const discriminantOf = (typeLiteral) => {
  for (const member of typeLiteral.members) {
    if (
      member.type === 'TSPropertySignature' &&
      !member.computed &&
      keyName(member.key) === 'type'
    ) {
      const annotation = member.typeAnnotation?.typeAnnotation;
      const literal = stringLiteralValue(annotation);
      if (literal) return literal;
    }
  }
  return null;
};

const isApproved = (name) => SUFFIXES.some((suffix) => name.endsWith(suffix));

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Every exported event union member in an island core must use an approved intent suffix.',
    },
    schema: [],
    messages: {
      badSuffix:
        "Event '{{name}}' must end with an approved intent suffix ({{suffixes}}): name what happened, not what to do.",
    },
  },
  create(context) {
    const report = (name, node) => {
      if (isApproved(name)) return;
      context.report({
        node,
        messageId: 'badSuffix',
        data: { name, suffixes: SUFFIXES.join(', ') },
      });
    };

    return {
      Program(program) {
        const aliases = new Map();
        const exportedUnions = [];
        const exportListNames = new Set();

        for (const statement of program.body) {
          if (statement.type === 'ExportNamedDeclaration' && !statement.declaration) {
            for (const specifier of statement.specifiers) {
              if (specifier.local.type === 'Identifier') exportListNames.add(specifier.local.name);
            }
          }
        }

        for (const statement of program.body) {
          let declaration = null;
          let exported = false;
          if (statement.type === 'TSTypeAliasDeclaration') {
            declaration = statement;
            exported = exportListNames.has(statement.id.name);
          } else if (
            statement.type === 'ExportNamedDeclaration' &&
            statement.declaration?.type === 'TSTypeAliasDeclaration'
          ) {
            declaration = statement.declaration;
            exported = true;
          }
          if (!declaration) continue;
          aliases.set(declaration.id.name, declaration.typeAnnotation);
          if (exported) exportedUnions.push(declaration);
        }

        const membersOf = (node) => {
          if (node.type === 'TSUnionType') return node.types;
          if (node.type === 'TSTypeReference' && node.typeName.type === 'Identifier') {
            const referenced = aliases.get(node.typeName.name);
            if (referenced?.type === 'TSUnionType') return referenced.types;
          }
          return [node];
        };

        const eventFromMember = (member) => {
          if (member.type === 'TSTypeLiteral') return discriminantOf(member);
          const literal = stringLiteralValue(member);
          if (literal) return literal;
          if (member.type === 'TSTypeReference' && member.typeName.type === 'Identifier') {
            const referenced = aliases.get(member.typeName.name);
            if (referenced?.type === 'TSTypeLiteral') {
              const discriminant = discriminantOf(referenced);
              if (discriminant) return { name: discriminant.name, node: member };
            }
          }
          return null;
        };

        for (const declaration of exportedUnions) {
          for (const member of membersOf(declaration.typeAnnotation)) {
            const event = eventFromMember(member);
            if (event) report(event.name, event.node);
          }
        }
      },
    };
  },
};
