import { call } from './call'

/** P3：商品图片（≤3 张，存 userData/product-images，product.images 存相对文件名 JSON） */
export const productImageApi = {
  save: (input: { product_id: number; file_name: string; data: string }) =>
    call<string>('productImage:save', input),
  remove: (productId: number, storedName: string) =>
    call<void>('productImage:remove', { product_id: productId, stored_name: storedName }),
  list: (productId: number) => call<string[]>('productImage:list', { product_id: productId })
}
