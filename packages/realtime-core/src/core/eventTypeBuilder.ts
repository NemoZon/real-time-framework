export type EventType = string;
export type EventTemplate = string;

const eventTypeBuilder = (template: string, ...params: (number | string | boolean)[]): string => {

  const placeholders = template.match(/\[.*?]/g) || [];


  if (placeholders.length !== params.length) {
    throw new Error(
      `Number of parameters (${params.length}) does not match the number of placeholders (${placeholders.length})`,
    );
  }


  let i = 0;
  return template.replace(/\[.*?]/g, () => String(params[i++]));
};

export default eventTypeBuilder;