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
const COMPOSER_MAX_HEIGHT = 120;

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
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);

  const isSendable =
    typeof canSend === 'boolean'
      ? canSend && !sending && !disabled
      : Boolean(value.trim()) && !sending && !disabled;

  useEffect(() => {
    if (!value) {
      setComposerHeight(COMPOSER_MIN_HEIGHT);
    }
  }, [value]);

  const handleContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const contentH = e?.nativeEvent?.contentSize?.height ?? 0;
      const next = Math.min(
        COMPOSER_MAX_HEIGHT,
        Math.max(COMPOSER_MIN_HEIGHT, Math.ceil(contentH) + 18)
      );
      setComposerHeight((prev) => (prev === next ? prev : next));
    },
    []
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
      <TextInput
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.input,
          { height: Math.max(COMPOSER_MIN_HEIGHT, composerHeight) },
          disabled && styles.inputDisabled,
        ]}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={handleContentSizeChange}
        onKeyPress={handleKeyPress}
        multiline
        maxLength={maxLength}
        editable={!sending && !disabled}
        textAlignVertical="center"
        blurOnSubmit={false}
      />

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
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: COMPOSER_MIN_HEIGHT,
    maxHeight: COMPOSER_MAX_HEIGHT,
    backgroundColor: '#F3F4F6',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 9,
    paddingBottom: Platform.OS === 'ios' ? 12 : 9,
    fontSize: 15,
    color: '#1F2937',
  },
  inputDisabled: {
    opacity: 0.6,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow({ color: '#EA580C', opacity: 0.25, radius: 6, y: 2, elevation: 2 }),
  },
  sendButtonDisabled: {
    backgroundColor: '#D1D5DB',
  },
});

export default ChatComposer;
