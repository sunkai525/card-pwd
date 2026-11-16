import type { Bindings } from './types'
import {
  bindDevice,
  countBindings,
  getCardByKey,
  getCardById,
  logVerify,
  updateCard,
} from './store'
import { DAY_MS, remainingDays } from './utils'

export type VerifyFailureCode = 'INVALID_KEY' | 'DISABLED' | 'EXPIRED' | 'DEVICE_LIMIT'

export type VerifyResult =
  | {
      valid: true
      key: string
      expires_at: number
      remaining_days: number
      bound_devices: number
      max_devices: number
      device_id: string
    }
  | { valid: false; code: VerifyFailureCode; message: string }

const FAILURE_MESSAGE: Record<VerifyFailureCode, string> = {
  INVALID_KEY: '卡密不存在',
  DISABLED: '卡密已被禁用',
  EXPIRED: '卡密已过期',
  DEVICE_LIMIT: '绑定设备数已达上限',
}

/**
 * 校验即核销：
 * 1. 首次校验 → 激活卡密，有效期从此时开始计算
 * 2. 同设备再次校验 → 仅刷新活跃时间
 * 3. 新设备校验 → 绑定；已达 max_devices 则拒绝
 */
export async function verifyCard(db: Bindings['DB'], key: string, deviceId: string): Promise<VerifyResult> {
  const t = Date.now()
  const card = await getCardByKey(db, key)

  if (!card) {
    await logVerify(db, { cardId: null, key, deviceId, result: 'invalid_key', t })
    return fail('INVALID_KEY')
  }

  if (card.status === 'disabled') {
    await logVerify(db, { cardId: card.id, key, deviceId, result: 'disabled', t })
    return fail('DISABLED')
  }

  if (card.status === 'expired') {
    await logVerify(db, { cardId: card.id, key, deviceId, result: 'expired', t })
    return fail('EXPIRED')
  }

  let expiresAt = card.expires_at
  if (card.activated_at == null || expiresAt == null) {
    // 首次激活：有效期从首次校验开始计算，WHERE 条件防止并发重复激活
    await db
      .prepare(
        'UPDATE card_keys SET status = ?, activated_at = ?, expires_at = ?, updated_at = ? WHERE id = ? AND activated_at IS NULL',
      )
      .bind('active', t, t + card.valid_days * DAY_MS, t, card.id)
      .run()
    // 以库中的结果为准（可能已被并发请求激活）
    expiresAt = (await getCardById(db, card.id))?.expires_at ?? t + card.valid_days * DAY_MS
  }

  if (t > expiresAt) {
    await updateCard(db, card.id, { status: 'expired' })
    await logVerify(db, { cardId: card.id, key, deviceId, result: 'expired', t })
    return fail('EXPIRED')
  }

  if (!(await bindDevice(db, card.id, deviceId, card.max_devices, t))) {
    await logVerify(db, { cardId: card.id, key, deviceId, result: 'device_limit', t })
    return fail('DEVICE_LIMIT')
  }

  await logVerify(db, { cardId: card.id, key, deviceId, result: 'ok', t })
  return {
    valid: true,
    key: card.key,
    expires_at: expiresAt,
    remaining_days: remainingDays(expiresAt),
    bound_devices: await countBindings(db, card.id),
    max_devices: card.max_devices,
    device_id: deviceId,
  }
}

function fail(code: VerifyFailureCode): VerifyResult {
  return { valid: false, code, message: FAILURE_MESSAGE[code] }
}
