/**
 * WebCrypto 加密服務
 * 用於安全地在 URL 中傳輸敏感設定
 */

export interface EncryptedData {
  iv: string;
  data: string;
  salt: string;
}

export interface PasswordEncryptionOptions {
  additionalData?: string;
  iterations?: number;
}

export class CryptoService {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 12;
  private static readonly SALT_LENGTH = 16;
  static readonly PBKDF2_ITERATIONS = 100_000;
  private static readonly DEFAULT_QUERY_PARAM = 'keys';

  /**
   * 從密碼生成加密金鑰
   */
  private static async deriveKey(
    password: string,
    salt: Uint8Array,
    iterations = this.PBKDF2_ITERATIONS,
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: this.ALGORITHM, length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * 加密任意 JSON 資料
   */
  static async encryptPayload<T>(payload: T, password: string): Promise<string> {
    try {
      const encrypted = await this.encryptPayloadWithPassword(payload, password);
      return this.arrayBufferToBase64Url(
        new TextEncoder().encode(JSON.stringify(encrypted)).buffer as ArrayBuffer,
      );
    } catch {
      throw new Error('無法加密資料');
    }
  }

  static async encryptPayloadWithPassword<T>(
    payload: T,
    password: string,
    options: PasswordEncryptionOptions = {},
  ): Promise<EncryptedData> {
    try {
      const salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
      const key = await this.deriveKey(password, salt, options.iterations);
      const additionalData = options.additionalData
        ? new TextEncoder().encode(options.additionalData)
        : undefined;
      const data = new TextEncoder().encode(JSON.stringify(payload));
      const encryptedBuffer = await crypto.subtle.encrypt(
        {
          name: this.ALGORITHM,
          iv,
          ...(additionalData === undefined ? {} : { additionalData }),
        },
        key,
        data,
      );

      return {
        iv: this.arrayBufferToBase64Url(iv.buffer as ArrayBuffer),
        data: this.arrayBufferToBase64Url(encryptedBuffer),
        salt: this.arrayBufferToBase64Url(salt.buffer as ArrayBuffer),
      };
    } catch {
      throw new Error('無法加密資料');
    }
  }

  /**
   * 解密任意 JSON 資料
   */
  static async decryptPayload<T>(encryptedString: string, password: string): Promise<T> {
    try {
      const decodedData = new TextDecoder().decode(this.base64UrlToArrayBuffer(encryptedString));
      const encrypted = JSON.parse(decodedData) as EncryptedData;
      return await this.decryptPayloadWithPassword<T>(encrypted, password);
    } catch {
      throw new Error('無法解密資料，請檢查密碼是否正確');
    }
  }

  static async decryptPayloadWithPassword<T>(
    encrypted: EncryptedData,
    password: string,
    options: PasswordEncryptionOptions = {},
  ): Promise<T> {
    try {
      const salt = this.base64UrlToArrayBuffer(encrypted.salt);
      const iv = this.base64UrlToArrayBuffer(encrypted.iv);
      const data = this.base64UrlToArrayBuffer(encrypted.data);
      const key = await this.deriveKey(password, new Uint8Array(salt), options.iterations);
      const additionalData = options.additionalData
        ? new TextEncoder().encode(options.additionalData)
        : undefined;
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv,
          ...(additionalData === undefined ? {} : { additionalData }),
        },
        key,
        data,
      );

      return JSON.parse(new TextDecoder().decode(decryptedBuffer)) as T;
    } catch {
      throw new Error('無法解密資料，請檢查密碼是否正確');
    }
  }

  /**
   * 保留舊 API：加密 API 金鑰數據
   */
  static async encryptApiKeys(apiKeys: Record<string, string>, password: string): Promise<string> {
    try {
      return await this.encryptPayload(apiKeys, password);
    } catch {
      throw new Error('無法加密 API 金鑰');
    }
  }

  /**
   * 保留舊 API：解密 API 金鑰數據
   */
  static async decryptApiKeys(
    encryptedString: string,
    password: string,
  ): Promise<Record<string, string>> {
    try {
      return await this.decryptPayload<Record<string, string>>(encryptedString, password);
    } catch {
      throw new Error('無法解密 API 金鑰，請檢查密碼是否正確');
    }
  }

  /**
   * 生成指定 query 參數的分享 URL
   */
  static generateSharingUrlForParam(paramName: string, encryptedData: string): string {
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      [paramName]: encryptedData,
    });

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * 保留舊 API：使用 keys 參數生成分享 URL
   */
  static generateSharingUrl(encryptedData: string, _password: string): string {
    return this.generateSharingUrlForParam(this.DEFAULT_QUERY_PARAM, encryptedData);
  }

  /**
   * 從 URL 中提取指定 query 參數
   */
  static extractFromUrl(paramName: string): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get(paramName);
  }

  /**
   * 保留舊 API：從 URL 中提取加密的 API 金鑰
   */
  static extractKeysFromUrl(): string | null {
    return this.extractFromUrl(this.DEFAULT_QUERY_PARAM);
  }

  /**
   * 從 URL 中移除指定 query 參數
   */
  static clearUrlParam(paramName: string): void {
    const url = new URL(window.location.href);
    url.searchParams.delete(paramName);
    window.history.replaceState({}, document.title, url.toString());
  }

  /**
   * 生成隨機密碼
   */
  static generateRandomPassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomValues = new Uint32Array(16);
    crypto.getRandomValues(randomValues);

    let result = '';
    for (let i = 0; i < randomValues.length; i++) {
      result += chars.charAt(randomValues[i] % chars.length);
    }
    return result;
  }

  /**
   * 將 ArrayBuffer 轉換為 URL-safe base64 字符串
   */
  private static arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * 將 URL-safe base64 字符串轉換為 ArrayBuffer
   */
  private static base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
    const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/') + padding;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export default CryptoService;
