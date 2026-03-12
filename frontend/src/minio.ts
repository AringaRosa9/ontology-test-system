import type { FormInstance } from 'antd';

type MinioConnectionValues = {
    endpoint?: string;
    access_key?: string;
    secret_key?: string;
    secure?: boolean;
};

export const MINIO_ENDPOINT_HELP =
    '支持填写 host:port 或完整 URL；请使用 MinIO API 端口 9000，不要填写 WebUI 的 9001。';

export function normalizeMinioConnectionValues(values: MinioConnectionValues) {
    const rawEndpoint = (values.endpoint || '').trim();
    let endpoint = rawEndpoint || 'localhost:9000';
    let secure = Boolean(values.secure);

    if (/^https?:\/\//i.test(endpoint)) {
        let parsed: URL;
        try {
            parsed = new URL(endpoint);
        } catch {
            throw new Error('MinIO Endpoint格式无效，请填写主机:端口或完整 URL');
        }
        if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
            throw new Error('MinIO Endpoint 只支持主机和端口，不要包含路径、参数或片段');
        }
        endpoint = parsed.host;
        secure = parsed.protocol === 'https:';
    }

    endpoint = endpoint.replace(/\/+$/, '');
    if (!endpoint) {
        throw new Error('MinIO Endpoint不能为空，请填写主机:端口或完整 URL');
    }
    if (endpoint.includes('/')) {
        throw new Error('MinIO Endpoint 只支持主机和端口，不要包含路径');
    }

    return {
        endpoint,
        access_key: values.access_key || '',
        secret_key: values.secret_key || '',
        secure,
    };
}

export function syncMinioEndpointForm(form: FormInstance<any>) {
    const normalized = normalizeMinioConnectionValues(form.getFieldsValue([
        'endpoint',
        'access_key',
        'secret_key',
        'secure',
    ]));
    form.setFieldsValue({ endpoint: normalized.endpoint, secure: normalized.secure });
    return normalized;
}
