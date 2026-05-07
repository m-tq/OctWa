/**
 * FeeSelector — reusable fee option picker.
 *
 * Shows Recommended / Fast (2×) / Custom options, matching the
 * pattern used in SendTransaction. Used by all PVAC operation dialogs.
 *
 * When Custom is selected, shows the OU input + OCT estimate directly below it.
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ouToOct } from '@/utils/api';

export type FeeOption = 'recommended' | 'fast' | 'custom'

interface FeeSelectorProps {
  recommendedFee: number
  feeOption: FeeOption
  customFee: string
  onFeeOptionChange: (option: FeeOption) => void
  onCustomFeeChange: (value: string) => void
  disabled?: boolean
  isPopupMode?: boolean
}

export function FeeSelector({
  recommendedFee,
  feeOption,
  customFee,
  onFeeOptionChange,
  onCustomFeeChange,
  disabled = false,
  isPopupMode = false,
}: FeeSelectorProps) {
  const fastFee = recommendedFee * 2
  const customFeeNum = parseInt(customFee) || 0
  const sizeClass = isPopupMode ? 'text-xs' : 'text-sm'
  const hClass = isPopupMode ? 'h-8' : 'h-9'

  return (
    <div className={isPopupMode ? 'space-y-1' : 'space-y-1.5'}>
      <Select
        value={feeOption}
        onValueChange={(v) => onFeeOptionChange(v as FeeOption)}
        disabled={disabled}
      >
        <SelectTrigger className={`${hClass} ${sizeClass}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recommended" className={sizeClass}>
            Recommended — {recommendedFee.toLocaleString()} OU ≈ {ouToOct(recommendedFee)} OCT
          </SelectItem>
          <SelectItem value="fast" className={sizeClass}>
            Fast — {fastFee.toLocaleString()} OU ≈ {ouToOct(fastFee)} OCT
          </SelectItem>
          <SelectItem value="custom" className={sizeClass}>
            Custom
          </SelectItem>
        </SelectContent>
      </Select>

      {feeOption === 'custom' && (
        <div className="space-y-1">
          <Input
            type="number"
            placeholder={`Enter OU (recommended: ${recommendedFee})`}
            value={customFee}
            onChange={(e) => onCustomFeeChange(e.target.value)}
            min="1"
            step="100"
            disabled={disabled}
            className={`font-mono ${hClass} ${sizeClass}`}
          />
          {/* OCT estimate shown directly below custom OU input */}
          {customFeeNum > 0 && (
            <p className={`text-muted-foreground font-mono ${isPopupMode ? 'text-[10px]' : 'text-xs'}`}>
              ≈ {ouToOct(customFeeNum)} OCT
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Compute effective fee in OU from selector state. */
export function getEffectiveFee(
  recommendedFee: number,
  feeOption: FeeOption,
  customFee: string,
): number {
  if (feeOption === 'fast') return recommendedFee * 2
  if (feeOption === 'custom') return parseInt(customFee) || recommendedFee
  return recommendedFee
}
