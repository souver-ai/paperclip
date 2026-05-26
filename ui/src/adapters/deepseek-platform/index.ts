import type { UIAdapterModule } from "../types";
import { SchemaConfigFields, buildSchemaAdapterConfig } from "../schema-config-fields";
import { parseProcessStdoutLine } from "../process/parse-stdout";

export const deepseekPlatformUIAdapter: UIAdapterModule = {
  type: "deepseek_platform",
  label: "DeepSeek Platform",
  parseStdoutLine: parseProcessStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildSchemaAdapterConfig,
};
