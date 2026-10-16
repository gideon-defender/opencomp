export const listRolesSchema = {
  type: 'object',
  properties: {
    builtInRoles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          isBuiltIn: { type: 'boolean' },
          description: { type: 'string' },
        },
      },
    },
    customRoles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          permissions: { type: 'object' },
          isBuiltIn: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

export const permissionsSchema = {
  type: 'object',
  properties: {
    permissions: {
      type: 'object',
      additionalProperties: { type: 'array', items: { type: 'string' } },
    },
  },
};

export const obligationsSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    obligations: {
      type: 'object',
      properties: { compliance: { type: 'boolean' } },
    },
  },
};

export const roleDetailsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    permissions: { type: 'object' },
    isBuiltIn: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
