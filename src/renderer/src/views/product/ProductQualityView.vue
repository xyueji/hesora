<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { productApi } from '../../api/product'
import { warehouseApi } from '../../api/warehouse'
import { hasPermission } from '../../stores/auth'
import type { Product } from '../../../../shared/types/product'
import type { Warehouse } from '../../../../shared/types/warehouse'

const products = ref<Product[]>([])
const productId = ref<number | null>(null)
const current = ref<Product | null>(null)
const shelfLifeDays = ref<number | null>(null)
const shelfLifeWarnDays = ref<number | null>(null)
const warehouses = ref<Warehouse[]>([])
const warehouseId = ref<number | null>(null)
const batchNo = ref('')
const productionDate = ref('')
const expireDate = ref('')
const batchRemark = ref('')
const saving = ref(false)
const searching = ref(false)

const canEdit = computed(() => hasPermission('product.shelf'))

async function searchProducts(keyword: string): Promise<void> {
  searching.value = true
  try {
    const r = await productApi.query({ page: 1, pageSize: 50, keyword: keyword || undefined })
    products.value = r.list
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    searching.value = false
  }
}

async function loadProduct(): Promise<void> {
  if (productId.value === null) {
    current.value = null
    return
  }
  try {
    const p = await productApi.get(productId.value)
    if (!p) {
      ElMessage.error('商品不存在')
      return
    }
    current.value = p
    shelfLifeDays.value = p.shelf_life_days ?? null
    shelfLifeWarnDays.value = p.shelf_life_warn_days ?? null
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function saveShelfLife(): Promise<void> {
  if (productId.value === null) {
    ElMessage.warning('请先选择商品')
    return
  }
  saving.value = true
  try {
    await productApi.setShelfLife(productId.value, {
      shelf_life_days: shelfLifeDays.value,
      shelf_life_warn_days: shelfLifeWarnDays.value
    })
    ElMessage.success('保质期设置已保存')
    await loadProduct()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

async function saveBatch(): Promise<void> {
  if (productId.value === null) {
    ElMessage.warning('请先选择商品')
    return
  }
  if (warehouseId.value === null) {
    ElMessage.warning('请先选择仓库')
    return
  }
  if (!batchNo.value.trim()) {
    ElMessage.warning('批次号不能为空')
    return
  }
  saving.value = true
  try {
    await productApi.saveBatch(productId.value, warehouseId.value, batchNo.value.trim(), {
      production_date: productionDate.value || undefined,
      expire_date: expireDate.value || undefined,
      remark: batchRemark.value || undefined
    })
    ElMessage.success('批次效期已保存')
    batchNo.value = ''
    productionDate.value = ''
    expireDate.value = ''
    batchRemark.value = ''
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  void searchProducts('')
  try {
    const r = await warehouseApi.query({ page: 1, pageSize: 100 })
    warehouses.value = r.list
  } catch {
    /* 仓库列表加载失败不阻塞 */
  }
})
</script>

<template>
  <div class="product-quality">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">保质期与批次效期</h3>
        <el-select
          v-model="productId"
          filterable
          remote
          :remote-method="searchProducts"
          :loading="searching"
          placeholder="选择商品"
          class="picker"
          @focus="searchProducts('')"
          @change="loadProduct"
        >
          <el-option
            v-for="p in products"
            :key="p.id"
            :label="`${p.code} ${p.name}`"
            :value="p.id as number"
          />
        </el-select>
      </div>

      <div class="section-title">保质期设置</div>
      <el-form label-width="120px" class="form">
        <el-form-item label="保质期（天）">
          <el-input-number v-model="shelfLifeDays" :min="0" :value-on-clear="null" />
        </el-form-item>
        <el-form-item label="临期预警（天）">
          <el-input-number v-model="shelfLifeWarnDays" :min="0" :value-on-clear="null" />
        </el-form-item>
        <el-form-item v-if="canEdit">
          <el-button type="primary" :loading="saving" @click="saveShelfLife">保存保质期</el-button>
        </el-form-item>
      </el-form>

      <div class="section-title">登记批次效期</div>
      <el-form label-width="120px" class="form">
        <el-form-item label="仓库">
          <el-select v-model="warehouseId" placeholder="选择仓库" class="picker">
            <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id as number" />
          </el-select>
        </el-form-item>
        <el-form-item label="批次号">
          <el-input v-model="batchNo" placeholder="批次号" />
        </el-form-item>
        <el-form-item label="生产日期">
          <el-input v-model="productionDate" placeholder="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="到期日期">
          <el-input v-model="expireDate" placeholder="YYYY-MM-DD，留空按保质期自动推算" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="batchRemark" placeholder="备注" />
        </el-form-item>
        <el-form-item v-if="canEdit">
          <el-button type="primary" :loading="saving" @click="saveBatch">保存批次</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="current"
        type="info"
        :closable="false"
        class="hint"
        :title="`当前商品：${current.code} ${current.name}`"
      />
    </el-card>
  </div>
</template>

<style scoped>
.product-quality {
  padding: 16px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.title {
  margin: 0;
  font-size: 16px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  margin: 16px 0 12px;
  padding-left: 8px;
  border-left: 3px solid var(--el-color-primary);
}
.form {
  max-width: 640px;
}
.picker {
  width: 240px;
}
.hint {
  margin-top: 12px;
}
</style>
