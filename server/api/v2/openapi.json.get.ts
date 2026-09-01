import { createPublicOpenApiDocument } from '../../openapi/publicApiDocument'

/**
 * 输出公共 API 实现与交互文档共用的唯一契约。
 * @returns 只描述公共 v2 业务接口的 OpenAPI 3.1 文档。
 * @remarks 契约路径允许匿名读取，不包含 v1 网页内部接口。
 */
export default defineEventHandler(() => createPublicOpenApiDocument())
