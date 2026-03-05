const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

function isActiveFlag(value) {
  // 兼容老数据：未设置 is_active 的视为启用
  if (typeof value === 'undefined' || value === null) return true
  return value === 1 || value === true || value === '1'
}

function asNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : NaN
}

function success(data = {}, message = 'ok') {
  return {
    code: 0,
    message,
    data
  }
}

function failure(code, message) {
  return {
    code,
    message
  }
}

async function getOrCreateUser(openid, userProfile) {
  const userRes = await db.collection('users').where({ openid }).limit(1).get()
  const now = new Date()

  if (!userRes.data.length) {
    const newUser = {
      openid,
      nickname: (userProfile && userProfile.nickname) || '',
      avatar: (userProfile && userProfile.avatar) || '',
      created_at: now
    }
    const addRes = await db.collection('users').add({ data: newUser })
    return { _id: addRes._id, ...newUser }
  }

  const user = userRes.data[0]
  const patch = {}
  if (userProfile && userProfile.nickname && userProfile.nickname !== user.nickname) {
    patch.nickname = userProfile.nickname
  }
  if (userProfile && userProfile.avatar && userProfile.avatar !== user.avatar) {
    patch.avatar = userProfile.avatar
  }
  if (Object.keys(patch).length) {
    await db.collection('users').doc(user._id).update({ data: patch })
    return { ...user, ...patch }
  }
  return user
}

async function listStoresByUserId(userId) {
  const relRes = await db.collection('user_stores').where({ user_id: userId }).limit(1000).get()
  if (!relRes.data.length) return []

  const storeIds = relRes.data.map(item => item.store_id)
  const storesRes = await db.collection('stores').where({
    _id: db.command.in(storeIds)
  }).limit(1000).get()

  const stores = storesRes.data.slice().sort((a, b) => String(a.store_code).localeCompare(String(b.store_code)))
  return stores.map(item => ({
    id: item._id,
    store_code: item.store_code,
    store_name: item.store_name
  }))
}

async function ensureStoreMembership(userId, storeId) {
  const relRes = await db.collection('user_stores').where({
    user_id: userId,
    store_id: storeId
  }).limit(1).get()
  return relRes.data.length > 0
}

async function handleGetUserAndStores(openid) {
  const user = await getOrCreateUser(openid)
  const stores = await listStoresByUserId(user._id)
  return success({
    user: {
      id: user._id,
      nickname: user.nickname || '',
      avatar: user.avatar || ''
    },
    stores
  })
}

async function handleCreateOrJoinStore(openid, data) {
  const storeCode = (data.store_code || '').trim()
  const storeName = (data.store_name || '').trim()
  const forceJoin = !!data.force_join

  if (!storeCode || !storeName) {
    return failure(4001, '门店编号和门店名称不能为空')
  }

  const user = await getOrCreateUser(openid, data.user_profile)
  const storeRes = await db.collection('stores').where({ store_code: storeCode }).limit(1).get()
  const now = new Date()

  if (!storeRes.data.length) {
    const addStoreRes = await db.collection('stores').add({
      data: {
        store_code: storeCode,
        store_name: storeName,
        created_at: now
      }
    })
    const storeId = addStoreRes._id
    await db.collection('user_stores').add({
      data: {
        user_id: user._id,
        store_id: storeId,
        role: 'owner',
        created_at: now
      }
    })
    return success({
      require_confirm: false,
      created: true,
      joined: true,
      store: {
        id: storeId,
        store_code: storeCode,
        store_name: storeName
      }
    }, '门店创建成功')
  }

  const existingStore = storeRes.data[0]
  const hasJoined = await ensureStoreMembership(user._id, existingStore._id)
  const sameName = existingStore.store_name === storeName

  if (!forceJoin && !hasJoined) {
    return success({
      require_confirm: true,
      created: false,
      joined: false,
      same_name: sameName,
      store: {
        id: existingStore._id,
        store_code: existingStore.store_code,
        store_name: existingStore.store_name
      }
    }, '门店已存在，请确认后加入')
  }

  if (!hasJoined) {
    await db.collection('user_stores').add({
      data: {
        user_id: user._id,
        store_id: existingStore._id,
        role: 'staff',
        created_at: now
      }
    })
  }

  return success({
    require_confirm: false,
    created: false,
    joined: true,
    store: {
      id: existingStore._id,
      store_code: existingStore.store_code,
      store_name: existingStore.store_name
    }
  }, hasJoined ? '你已加入该门店' : '加入门店成功')
}

async function handleGetInventoryEditData(openid, data) {
  const storeId = data.store_id
  if (!storeId) return failure(4002, '缺少 store_id')

  const user = await getOrCreateUser(openid)
  const hasJoined = await ensureStoreMembership(user._id, storeId)
  if (!hasJoined) return failure(4003, '你未加入该门店，无法盘点')

  const storeRes = await db.collection('stores').doc(storeId).get()
  const store = storeRes.data
  if (!store) return failure(4041, '门店不存在')

  const categoriesRes = await db.collection('categories').limit(1000).get()
  const materialsRes = await db.collection('materials').limit(1000).get()

  const rawCategories = categoriesRes.data || []
  const rawMaterials = materialsRes.data || []

  const materials = rawMaterials
    .filter(item => isActiveFlag(item.is_active))

  const hasCategoryCollection = rawCategories.length > 0
  const materialsUseCategoryId = materials.some(item => !!item.category_id)

  let categoryList = []

  if (hasCategoryCollection && materialsUseCategoryId) {
    const categories = rawCategories
      .filter(item => isActiveFlag(item.is_active))
      .sort((a, b) => Number(a.sort_id || 0) - Number(b.sort_id || 0))

    const orderedMaterials = materials
      .sort((a, b) => Number(a.sort_id || 0) - Number(b.sort_id || 0))

    const materialsByCategory = {}
    orderedMaterials.forEach(item => {
      const cid = item.category_id
      if (!materialsByCategory[cid]) materialsByCategory[cid] = []
      materialsByCategory[cid].push({
        material_id: item._id,
        name: item.name,
        unit: item.unit,
        sort_id: item.sort_id,
        quantity: ''
      })
    })

    categoryList = categories.map(category => ({
      category_id: category._id,
      name: category.name,
      sort_id: category.sort_id,
      materials: materialsByCategory[category._id] || []
    }))
  } else {
    // 兼容当前数据结构：materials 中直接包含 category_name / category_sort_id / material_name / material_sort_id
    const orderedMaterials = materials
      .sort((a, b) => {
        const catDiff = Number(a.category_sort_id || 0) - Number(b.category_sort_id || 0)
        if (catDiff !== 0) return catDiff
        return Number(a.material_sort_id || 0) - Number(b.material_sort_id || 0)
      })

    const categoryMap = new Map()
    orderedMaterials.forEach(item => {
      const key = `${item.category_name}__${item.category_sort_id || 0}`
      if (!categoryMap.has(key)) {
        categoryMap.set(key, {
          category_id: key,
          name: item.category_name,
          sort_id: Number(item.category_sort_id || 0),
          materials: []
        })
      }
      categoryMap.get(key).materials.push({
        material_id: item._id,
        name: item.material_name,
        unit: item.unit,
        sort_id: Number(item.material_sort_id || 0),
        quantity: ''
      })
    })

    categoryList = Array.from(categoryMap.values()).sort((a, b) => a.sort_id - b.sort_id)
  }

  return success({
    store: {
      id: store._id,
      store_code: store.store_code,
      store_name: store.store_name
    },
    categories: categoryList
  })
}

async function handleCreateInventoryWithItems(openid, data) {
  const storeId = data.store_id
  const items = Array.isArray(data.items) ? data.items : []

  if (!storeId) return failure(4002, '缺少 store_id')
  if (!items.length) return failure(4004, '盘点明细不能为空')

  const user = await getOrCreateUser(openid, data.user_profile)
  const hasJoined = await ensureStoreMembership(user._id, storeId)
  if (!hasJoined) return failure(4003, '你未加入该门店，无法盘点')

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (item.quantity === '' || item.quantity === null || typeof item.quantity === 'undefined') {
      return failure(4005, '存在未填写数量')
    }
    const q = asNumber(item.quantity)
    if (Number.isNaN(q) || q < 0) {
      return failure(4006, '数量必须是大于等于 0 的数字')
    }
  }

  const now = new Date()
  const inventoryRes = await db.collection('inventories').add({
    data: {
      store_id: storeId,
      user_id: user._id,
      finished_at: now,
      created_at: now
    }
  })

  const inventoryId = inventoryRes._id
  const writeJobs = items.map(item => db.collection('inventory_items').add({
    data: {
      inventory_id: inventoryId,
      category_name_snapshot: item.category_name,
      category_sort_id: Number(item.category_sort_id || 0),
      material_name_snapshot: item.material_name,
      material_sort_id: Number(item.material_sort_id || 0),
      unit_snapshot: item.unit || '',
      quantity: asNumber(item.quantity)
    }
  }))
  await Promise.all(writeJobs)

  return success({
    inventory_id: inventoryId
  }, '提交成功')
}

async function handleGetInventoryDetail(data) {
  const inventoryId = data.inventory_id
  if (!inventoryId) return failure(4007, '缺少 inventory_id')

  const inventoryRes = await db.collection('inventories').doc(inventoryId).get()
  const inventory = inventoryRes.data
  if (!inventory) return failure(4042, '盘点记录不存在')

  const [storeRes, userRes, itemsRes, materialsRes] = await Promise.all([
    db.collection('stores').doc(inventory.store_id).get(),
    db.collection('users').doc(inventory.user_id).get(),
    db.collection('inventory_items').where({ inventory_id: inventoryId }).limit(1000).get(),
    db.collection('materials').limit(1000).get()
  ])

  const activeMaterialNames = new Set(
    materialsRes.data.filter(item => isActiveFlag(item.is_active)).map(item => item.name)
  )

  const sortedItems = itemsRes.data.slice().sort((a, b) => {
    const categoryDiff = Number(a.category_sort_id || 0) - Number(b.category_sort_id || 0)
    if (categoryDiff !== 0) return categoryDiff
    return Number(a.material_sort_id || 0) - Number(b.material_sort_id || 0)
  })

  const categoryMap = new Map()
  sortedItems.forEach(item => {
    const key = `${item.category_name_snapshot}__${item.category_sort_id}`
    if (!categoryMap.has(key)) {
      categoryMap.set(key, {
        category_id: key,
        name: item.category_name_snapshot,
        sort_id: Number(item.category_sort_id || 0),
        materials: []
      })
    }
    categoryMap.get(key).materials.push({
      material_name: item.material_name_snapshot,
      name: item.material_name_snapshot,
      unit: item.unit_snapshot,
      quantity: item.quantity,
      isInactive: !activeMaterialNames.has(item.material_name_snapshot)
    })
  })

  const categories = Array.from(categoryMap.values()).sort((a, b) => a.sort_id - b.sort_id)

  return success({
    inventory_id: inventoryId,
    store: {
      id: storeRes.data._id,
      store_code: storeRes.data.store_code,
      store_name: storeRes.data.store_name
    },
    finished_at: inventory.finished_at,
    user_nickname: (userRes.data && userRes.data.nickname) || '',
    categories
  })
}

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const action = event.action
    const data = event.data || {}

    switch (action) {
      case 'getUserAndStores':
        return await handleGetUserAndStores(OPENID)
      case 'createOrJoinStore':
        return await handleCreateOrJoinStore(OPENID, data)
      case 'getInventoryEditData':
        return await handleGetInventoryEditData(OPENID, data)
      case 'createInventoryWithItems':
        return await handleCreateInventoryWithItems(OPENID, data)
      case 'getInventoryDetail':
        return await handleGetInventoryDetail(data)
      default:
        return failure(4000, '未知 action')
    }
  } catch (error) {
    return failure(5000, error.message || '云函数执行失败')
  }
}


