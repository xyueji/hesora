<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { productApi } from '../../api/product'
import type { Product, ProductUnit, TrackingType } from '../../../../shared/types/product'

const route = useRoute()
const router = useRouter()

const id = computed(() => {
  const v = route.params.id
  return v ? Number(v) : null
})
const isEdit = computed(() => id.value !== null)

const form = ref<Product>({
  code: '',
  name: '',
  spec: '',
  category: '',
  base_unit: '',
  retail_price: 0,
  trade_price: 0,
  purchase_price: 0,
  min_stock: null,
  remark: '',
  tracking_type: 'none',
  units: [],
  barcodes: []
})

const unitRows = ref<ProductUnit[]>([])
const barcodes = ref<string[]>([])
const newBarcode = ref('')
const saving = ref(false)

const trackingOptions: { value: TrackingType; label: string }[] = [
  { value: 'none', label: '不追踪' },
  { value: 'batch', label: '批次' },
  { value: 'serial', label: '序列号' }
]

function addUnit(): void {
  unitRows.value.push({ unit: '', rate: 1 })
}

function removeUnit(index: number): void {
  unitRows.value.splice(index, 1)
}

function addBarcode(): void {
  const v = newBarcode.value.trim()
  if (!v) return
  if (barcodes.value.includes(v)) {
    ElMessage.warning('条码已存在')
    return
  }
  barcodes.value.push(v)
  newBarcode.value = ''
}

function removeBarcode(b: string): void {
  barcodes.value = barcodes.value.filter((x) => x !== b)
}

async function load(): Promise<void> {
  if (!isEdit.value) return
  try {
    const p = await productApi.get(id.value!)
    if (!p) {
      ElMessage.error('商品不存在')
      return
    }
    form.value = p
    unitRows.value = p.units ? [...p.units] : []
    barcodes.value = p.barcodes ? [...p.barcodes] : []
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

async function save(): Promise<void> {
  if (!form.value.code.trim() || !form.value.name.trim() || !form.value.base_unit.trim()) {
    ElMessage.warning('编码、名称、基本单位为必填项')
    return
  }
  saving.value = true
  try {
    const payload: Omit<Product, 'id'> = {
      ...form.value,
      units: unitRows.value,
      barcodes: barcodes.value
    }
    if (isEdit.value) await productApi.update(id.value!, payload)
    else await productApi.create(payload)
    ElMessage.success('保存成功')
    router.push('/product/list')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="product-edit">
    <el-card shadow="never">
      <div class="header">
        <h3 class="title">{{ isEdit ? '编辑商品' : '新增商品' }}</h3>
        <div class="actions">
          <el-button @click="router.push('/product/list')">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>

      <el-form label-width="100px" class="form">
        <div class="section-title">基本信息</div>
        <div class="grid">
          <el-form-item label="编码" required>
            <el-input v-model="form.code" :disabled="isEdit" placeholder="商品编码" />
          </el-form-item>
          <el-form-item label="名称" required>
            <el-input v-model="form.name" placeholder="商品名称" />
          </el-form-item>
          <el-form-item label="规格">
            <el-input v-model="form.spec" placeholder="规格型号" />
          </el-form-item>
          <el-form-item label="类别">
            <el-input v-model="form.category" placeholder="商品类别" />
          </el-form-item>
          <el-form-item label="基本单位" required>
            <el-input v-model="form.base_unit" placeholder="如：罐 / 瓶 / 个" />
          </el-form-item>
          <el-form-item label="追踪方式">
            <el-radio-group v-model="form.tracking_type">
              <el-radio v-for="t in trackingOptions" :key="t.value" :value="t.value">
                {{ t.label }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
        </div>

        <div class="section-title">价格</div>
        <div class="grid">
          <el-form-item label="零售价">
            <el-input-number v-model="form.retail_price" :precision="2" :min="0" />
          </el-form-item>
          <el-form-item label="批发价">
            <el-input-number v-model="form.trade_price" :precision="2" :min="0" />
          </el-form-item>
          <el-form-item label="进货价">
            <el-input-number v-model="form.purchase_price" :precision="2" :min="0" />
          </el-form-item>
          <el-form-item label="最低库存">
            <el-input-number v-model="form.min_stock" :min="0" :value-on-clear="null" />
          </el-form-item>
        </div>

        <div class="section-title">多单位</div>
        <el-table :data="unitRows" size="small" class="units-table" empty-text="暂无多单位，可点击下方添加">
          <el-table-column label="单位" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.unit" placeholder="如：箱" />
            </template>
          </el-table-column>
          <el-table-column label="换算率" min-width="140">
            <template #default="{ row }">
              <el-input-number v-model="row.rate" :min="0" :precision="2" controls-position="right" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ $index }">
              <el-button link type="danger" @click="removeUnit($index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button class="mt" size="small" @click="addUnit">添加单位</el-button>

        <div class="section-title">条码</div>
        <div class="barcodes">
          <el-tag
            v-for="b in barcodes"
            :key="b"
            closable
            class="barcode-tag"
            @close="removeBarcode(b)"
          >
            {{ b }}
          </el-tag>
          <el-input
            v-model="newBarcode"
            placeholder="输入条码后回车添加"
            class="barcode-input"
            size="small"
            @keyup.enter="addBarcode"
          />
        </div>

        <div class="section-title">备注</div>
        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="备注" />
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.product-edit {
  padding: 16px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.title {
  margin: 0;
  font-size: 16px;
}
.form {
  max-width: 860px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  margin: 16px 0 12px;
  padding-left: 8px;
  border-left: 3px solid var(--el-color-primary);
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  column-gap: 24px;
}
.units-table {
  max-width: 560px;
}
.mt {
  margin-top: 8px;
}
.barcodes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.barcode-input {
  width: 220px;
}
</style>
