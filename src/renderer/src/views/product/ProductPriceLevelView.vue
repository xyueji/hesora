<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { productApi } from '../../api/product'
import { hasPermission } from '../../stores/auth'
import type { PriceLevel, Product } from '../../../../shared/types/product'

const products = ref<Product[]>([])
const productId = ref<number | null>(null)
const current = ref<Product | null>(null)
const levels = ref<PriceLevel[]>([])
const saving = ref(false)
const searching = ref(false)

const canEdit = computed(() => hasPermission('product.price'))

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
    levels.value = []
    return
  }
  try {
    const p = await productApi.get(productId.value)
    if (!p) {
      ElMessage.error('商品不存在')
      return
    }
    current.value = p
    levels.value = (p.price_levels ?? []).map((l) => ({ ...l }))
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function addRow(): void {
  levels.value.push({ price_level: '', price: 0 })
}

function removeRow(index: number): void {
  levels.value.splice(index, 1)
}

async function save(): Promise<void> {
  if (productId.value === null) {
    ElMessage.warning('请先选择商品')
    return
  }
  saving.value = true
  try {
    await productApi.setPriceLevels(productId.value, levels.value)
    ElMessage.success('价格等级已保存')
    await loadProduct()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void searchProducts('')
})
</script>

<template>
  <div class="price-level">
    <el-card shadow="never">
      <div class="toolbar">
        <h3 class="title">价格等级管理</h3>
        <div class="actions">
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
          <el-button v-if="canEdit" @click="addRow">新增等级</el-button>
          <el-button v-if="canEdit" type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-alert
        v-if="current"
        type="info"
        show-icon
        :closable="false"
        class="hint"
        :title="`当前商品零售价 ${current.retail_price.toFixed(2)} 元；未维护对应等级时按零售价取价`"
      />

      <el-table :data="levels" size="small" class="table" empty-text="尚未设置价格等级">
        <el-table-column label="等级名称" min-width="200">
          <template #default="{ row }">
            <el-input v-model="row.price_level" placeholder="如：零售价 / 批发价 / 会员价" />
          </template>
        </el-table-column>
        <el-table-column label="价格（元）" min-width="180">
          <template #default="{ row }">
            <el-input-number v-model="row.price" :min="0" :precision="2" controls-position="right" />
          </template>
        </el-table-column>
        <el-table-column v-if="canEdit" label="操作" width="80">
          <template #default="{ $index }">
            <el-button link type="danger" @click="removeRow($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.price-level {
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
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.picker {
  width: 280px;
}
.hint {
  margin-bottom: 12px;
}
.table {
  width: 100%;
}
</style>
