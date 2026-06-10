const DEPRECATED_ZOD_STRING_FORMATS = {
  email: "z.email()",
  url: "z.url()",
  jwt: "z.jwt()",
  emoji: "z.emoji()",
  guid: "z.guid()",
  uuid: "z.uuid()",
  uuidv4: "z.uuid()",
  uuidv6: "z.uuid()",
  uuidv7: "z.uuid()",
  nanoid: "z.nanoid()",
  cuid: "z.cuid()",
  cuid2: "z.cuid2()",
  ulid: "z.ulid()",
  base64: "z.base64()",
  base64url: "z.base64url()",
  xid: "z.xid()",
  ksuid: "z.ksuid()",
  ipv4: "z.ipv4()",
  ipv6: "z.ipv6()",
  cidrv4: "z.cidrv4()",
  cidrv6: "z.cidrv6()",
  e164: "z.e164()",
  datetime: "z.iso.datetime()",
  date: "z.iso.date()",
  time: "z.iso.time()",
  duration: "z.iso.duration()",
};

function isIdentifier(node, nameSet) {
  return node?.type === "Identifier" && nameSet.has(node.name);
}

function isDeprecatedFormatCall(node, zFactoryNames) {
  if (node?.type !== "CallExpression") {
    return null;
  }

  const callee = node.callee;
  if (
    !callee ||
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.property?.type !== "Identifier"
  ) {
    return null;
  }

  const methodName = callee.property.name;
  const replacement = DEPRECATED_ZOD_STRING_FORMATS[methodName];
  if (!replacement) {
    return null;
  }

  let current = callee.object;
  while (current?.type === "CallExpression") {
    const currentCallee = current.callee;
    if (
      currentCallee?.type === "MemberExpression" &&
      !currentCallee.computed &&
      currentCallee.property?.type === "Identifier"
    ) {
      if (
        currentCallee.property.name === "string" &&
        isIdentifier(currentCallee.object, zFactoryNames)
      ) {
        return { methodName, replacement };
      }

      current = currentCallee.object;
      continue;
    }

    break;
  }

  return null;
}

export default {
  meta: {
    name: "grove-zod",
  },
  rules: {
    "no-deprecated-zod-string-formats": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow deprecated Zod chained string format validators (z.string().uuid/url/datetime/etc).",
        },
        schema: [],
        messages: {
          deprecatedChainedFormat:
            "Deprecated Zod chained format `z.string().{{method}}(...)`. Use `{{replacement}}` and compose with `.pipe(...)` when pre-normalization (e.g. trim) is needed.",
        },
      },
      create(context) {
        const zFactoryNames = new Set(["z"]);

        return {
          ImportDeclaration(node) {
            if (node.source?.type !== "Literal" || node.source.value !== "zod") {
              return;
            }

            for (const specifier of node.specifiers ?? []) {
              if (
                specifier.type === "ImportSpecifier" &&
                specifier.imported?.type === "Identifier" &&
                specifier.imported.name === "z" &&
                specifier.local?.type === "Identifier"
              ) {
                zFactoryNames.add(specifier.local.name);
              }

              if (
                specifier.type === "ImportNamespaceSpecifier" &&
                specifier.local?.type === "Identifier"
              ) {
                zFactoryNames.add(specifier.local.name);
              }
            }
          },
          CallExpression(node) {
            const match = isDeprecatedFormatCall(node, zFactoryNames);
            if (!match) {
              return;
            }

            context.report({
              node,
              messageId: "deprecatedChainedFormat",
              data: {
                method: match.methodName,
                replacement: match.replacement,
              },
            });
          },
        };
      },
    },
  },
};
