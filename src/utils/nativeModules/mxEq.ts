import { NativeModules } from 'react-native'

const { MxEq } = NativeModules

export interface EqState {
  enabled: boolean
  preamp: number
  gains: number[]
  freqs: number[]
  processedFrames?: number
}

export const EQ_BAND_COUNT = 11

export const getEqState = async(): Promise<EqState | null> => {
  if (!MxEq?.getState) return null
  try {
    return await MxEq.getState()
  } catch {
    return null
  }
}

export const setEqEnabled = async(enabled: boolean) => {
  if (!MxEq?.setEnabled) return
  try { await MxEq.setEnabled(enabled) } catch {}
}

export const setEqGain = async(band: number, db: number) => {
  if (!MxEq?.setGain) return
  try { await MxEq.setGain(band, db) } catch {}
}

export const setEqPreamp = async(db: number) => {
  if (!MxEq?.setPreamp) return
  try { await MxEq.setPreamp(db) } catch {}
}

export const setEqAll = async(gains: number[], enabled: boolean, preamp: number) => {
  if (!MxEq?.setAll) return
  try { await MxEq.setAll(gains, enabled, preamp) } catch {}
}

export const resetEq = async() => {
  if (!MxEq?.reset) return
  try { await MxEq.reset() } catch {}
}
