import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputContentSizeChangeEventData,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from 'react-native';
import { Send } from 'lucide-react-native';
import { AppSpinner } from '../ui/AppSpinner';
import { shadow } from '../../src/lib/shadow';

const COMPOSER_MIN_HEIGHT = 44;
const SINGLE_LINE_INPUT_HEIGHT = 22;
const COMPOSER_MAX_HEIGHT = 112;

export interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  canSend?: boolean;
  placeholder?: string;
  maxLength?: number;
  containerStyle?: StyleProp<ViewStyle>;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  testID?: string;
  sendTestID?: string;
  accessibilityLabel?: string;
  sendAccessibilityLabel?: string;
}

/**
 * ChatComposer
 * Follows the Chat Composer Caret Alignment Rule:
 * NEVER specify explicit `lineHeight` in styles for single-line / auto-expanding inputs.
 */
export function ChatComposer({
  value,
  onChangeText,
  onSend,
  sending = false,
  disabled = false,
  canSend,
  placeholder = 'Ask Billing AI anything...',
  maxLength = 1000,
  containerStyle,
  paddingBottom = 8,
  paddingLeft = 12,
  paddingRight = 12,
  testID = 'chat-input',
  sendTestID = 'chat-send-button',
  accessibilityLabel = 'Chat message input',
  sendAccessibilityLabel = 'Send message',
}: ChatComposerProps) {
  const [composerHeight, setComposerHeight] = useState(SINGLE_LINE_INPUT_HEIGHT);
  const [isFocused, setIsFocused] = useState(false);

  const isSendable =
    typeof canSend === 'boolean'
      ? canSend && !sending && !disabled
      : Boolean(value.trim()) && !sending && !disabled;

  useEffect(() => {
    if (!value || !value.trim()) {
      setComposerHeight(SINGLE_LINE_INPUT_HEIGHT);
    }
  }, [value]);

  const handleContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      if (!value || !value.trim()) {
        setComposerHeight(SINGLE_LINE_INPUT_HEIGHT);
        return;
      }
      const contentH = e?.nativeEvent?.contentSize?.height ?? 0;
      if (!contentH) return;
      if (!value.includes('\n') && contentH <= 32) {
        setComposerHeight(SINGLE_LINE_INPUT_HEIGHT);
        return;
      }
      const next = Math.min(
        COMPOSER_MAX_HEIGHT,
        Math.max(SINGLE_LINE_INPUT_HEIGHT, Math.ceil(contentH))
      );
      setComposerHeight((prev) => (prev === next ? prev : next));
    },
    [value]
  );

  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (Platform.OS !== 'web') return;
      const nativeEvent = e.nativeEvent as TextInputKeyPressEventData & {
        shiftKey?: boolean;
        preventDefault?: () => void;
      };
      if (nativeEvent.key === 'Enter' && !nativeEvent.shiftKey) {
        if (typeof (e as unknown as { preventDefault?: () => void }).preventDefault === 'function') {
          (e as unknown as { preventDefault: () => void }).preventDefault();
        }
        if (isSendable) {
          onSend();
        }
      }
    },
    [isSendable, onSend]
  );

  return (
    <View
      style={[
        styles.inputContainer,
        {
          paddingBottom,
          paddingLeft,
          paddingRight,
        },
        containerStyle,
      ]}
    >
      <View
        style={[
          styles.inputPillWrapper,
          isFocused && styles.inputPillWrapperFocused,
          disabled && styles.inputDisabled,
        ]}
        testID={`${testID}-pill-wrapper`}
      >
        <TextInput
          testID={testID}
          accessibilityLabel={accessibilityLabel}
          style={[
            styles.input,
            { height: Math.max(SINGLE_LINE_INPUT_HEIGHT, composerHeight) },
          ]}
          placeholder={placeholder}
          placeholderTextColor="#94A3B8"
          value={value}
          onChangeText={onChangeText}
          onContentSizeChange={handleContentSizeChange}
          onKeyPress={handleKeyPress}
          onFocus={() => {
            setIsFocused(true);
            if (!value || !value.trim()) {
              setComposerHeight(SINGLE_LINE_INPUT_HEIGHT);
            }
          }}
          onBlur={() => setIsFocused(false)}
          multiline
          numberOfLines={1}
          {...(Platform.OS === 'web'
            ? ({ rows: 1 } as Record<string, unknown>)
            : {})}
          maxLength={maxLength}
          editable={!sending && !disabled}
          textAlignVertical="center"
          blurOnSubmit={false}
        />
      </View>

      <Pressable
        testID={sendTestID}
        style={[styles.sendButton, !isSendable && styles.sendButtonDisabled]}
        onPress={onSend}
        disabled={!isSendable}
        accessibilityRole="button"
        accessibilityLabel={sendAccessibilityLabel}
        accessibilityState={{ disabled: !isSendable, busy: sending }}
      >
        {sending ? (
          <AppSpinner size={18} color="#FFFFFF" />
        ) : (
          <Send size={18} color="#FFFFFF" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    gap: 10,
  },
  inputPillWrapper: {
    flex: 1,
    minHeight: COMPOSER_MIN_HEIGHT,
    maxHeight: COMPOSER_MAX_HEIGHT + 22,
    backgroundColor: '#F8FAFC',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  inputPillWrapperFocused: {
    backgroundColor: '#FFFFFF',
    borderColor: '#F59E0B',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 0 0 3px rgba(245, 158, 11, 0.16)' } as unknown as ViewStyle)
      : {}),
  },
  input: {
    width: '100%',
    minHeight: SINGLE_LINE_INPUT_HEIGHT,
    maxHeight: COMPOSER_MAX_HEIGHT,
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingTop: Platform.OS === 'ios' ? 2 : 1,
    paddingBottom: Platform.OS === 'ios' ? 2 : 1,
    margin: 0,
    fontSize: 15,
    color: '#0F172A',
    ...(Platform.OS === 'web'
      ? ({
          overflowY: 'auto',
          outlineStyle: 'none',
          outlineWidth: 0,
        } as unknown as ViewStyle)
      : {}),
  },
  inputDisabled: {
    opacity: 0.6,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    ...shadow({ color: '#EA580C', opacity: 0.25, radius: 6, y: 2, elevation: 2 }),
  },
  sendButtonDisabled: {
    backgroundColor: '#CBD5E1',
  },
});

export default ChatComposer;
