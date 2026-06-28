package com.stocktemp.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private SharedPreferences prefs;
    private Handler mainHandler;

    // iFinD token 管理
    private String accessToken = null;
    private long tokenExpiry = 0;

    private static final String IFIND_BASE = "https://quantapi.51ifind.com/api/v1";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        prefs = getSharedPreferences("stocktemp", MODE_PRIVATE);
        mainHandler = new Handler(Looper.getMainLooper());

        // 创建布局
        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        // 配置 WebView
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);  // localStorage 缓存
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setAllowUniversalAccessFromFileURLs(true);

        // 注入 JS 接口
        webView.addJavascriptInterface(new WebAppInterface(this), "Android");

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        // 加载本地 HTML
        webView.loadUrl("file:///android_asset/www/index.html");

        hideSystemUI();
    }

    private void hideSystemUI() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    // ━━━ iFinD HTTP 请求 ━━━
    private String httpPost(String urlStr, String jsonBody, String token) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        if (token != null) {
            conn.setRequestProperty("access_token", token);
        }
        conn.setDoOutput(true);
        conn.setConnectTimeout(30000);
        conn.setReadTimeout(60000);

        try (OutputStream os = conn.getOutputStream()) {
            os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
        }

        int code = conn.getResponseCode();
        BufferedReader reader = new BufferedReader(
            new InputStreamReader(code >= 200 && code < 300
                ? conn.getInputStream() : conn.getErrorStream(), StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line);
        reader.close();
        conn.disconnect();
        return sb.toString();
    }

    private String ensureToken() throws Exception {
        if (accessToken != null && System.currentTimeMillis() < tokenExpiry) {
            return accessToken;
        }

        String refreshToken = prefs.getString("refresh_token", "");
        if (refreshToken.isEmpty()) {
            throw new RuntimeException("NO_TOKEN");
        }

        String body = "{}";
        String resp = httpPost(IFIND_BASE + "/get_access_token", body, null);

        // 实际请求需要在 header 中传 refresh_token
        URL url = new URL(IFIND_BASE + "/get_access_token");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("refresh_token", refreshToken);
        conn.setDoOutput(true);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.getOutputStream().write("{}".getBytes(StandardCharsets.UTF_8));

        int code = conn.getResponseCode();
        BufferedReader reader = new BufferedReader(
            new InputStreamReader(code >= 200 && code < 300
                ? conn.getInputStream() : conn.getErrorStream(), StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line);
        reader.close();
        conn.disconnect();

        JSONObject json = new JSONObject(sb.toString());
        if (json.optInt("errorcode", -1) != 0) {
            throw new RuntimeException("TOKEN_ERROR: " + json.optString("error", "unknown"));
        }

        JSONObject data = json.getJSONObject("data");
        accessToken = data.getString("access_token");
        tokenExpiry = System.currentTimeMillis() + 6L * 24 * 3600 * 1000;  // 6天
        return accessToken;
    }

    // ━━━ JS 调用的接口 ━━━
    public class WebAppInterface {

        @JavascriptInterface
        public boolean isAndroid() {
            return true;
        }

        @JavascriptInterface
        public String getRefreshToken() {
            return prefs.getString("refresh_token", "");
        }

        @JavascriptInterface
        public void setRefreshToken(String token) {
            prefs.edit().putString("refresh_token", token).apply();
            // 重置 access_token，下次请求时重新获取
            accessToken = null;
            tokenExpiry = 0;
        }

        @JavascriptInterface
        public boolean hasRefreshToken() {
            return !prefs.getString("refresh_token", "").isEmpty();
        }

        @JavascriptInterface
        public boolean isNetworkAvailable() {
            ConnectivityManager cm = (ConnectivityManager)
                getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            NetworkInfo info = cm.getActiveNetworkInfo();
            return info != null && info.isConnected();
        }

        @JavascriptInterface
        public void showToast(String msg) {
            mainHandler.post(() ->
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        /**
         * 获取指数历史行情 (同步，JS 需在 Promise 中调用)
         * 返回 JSON: { dates:[], close:[], volume:[], amount:[], pe:[], ... } 或 { error: "..." }
         */
        @JavascriptInterface
        public String fetchIndexHistory(String ifindCode, String startDate, String endDate) {
            try {
                String token = ensureToken();
                JSONObject para = new JSONObject();
                para.put("codes", ifindCode);
                para.put("indicators", "preClose,open,high,low,close,changeRatio,volume,amount,pe_ttm_index");
                para.put("startdate", startDate.replace("-", ""));
                para.put("enddate", endDate.replace("-", ""));
                JSONObject fp = new JSONObject();
                fp.put("Fill", "Blank");
                fp.put("CPS", "1");
                fp.put("Currency", "RMB");
                para.put("functionpara", fp);

                String resp = httpPost(IFIND_BASE + "/cmd_history_quotation",
                    para.toString(), token);
                JSONObject json = new JSONObject(resp);

                if (json.optInt("errorcode", -1) != 0) {
                    return "{\"error\":\"" + json.optString("error", "API error") + "\"}";
                }

                JSONArray tables = json.optJSONArray("tables");
                if (tables == null || tables.length() == 0) {
                    return "{\"dates\":[],\"close\":[]}";
                }

                JSONObject item = tables.getJSONObject(0);
                JSONArray times = item.optJSONArray("time");
                JSONObject table = item.optJSONObject("table");

                if (times == null || table == null) {
                    return "{\"dates\":[],\"close\":[]}";
                }

                // 构建返回对象
                JSONObject result = new JSONObject();
                JSONArray dates = new JSONArray();
                for (int i = 0; i < times.length(); i++) {
                    String d = times.getString(i);
                    // 转换 "2024-05-29" 格式
                    if (d.length() == 8 && !d.contains("-")) {
                        d = d.substring(0, 4) + "-" + d.substring(4, 6) + "-" + d.substring(6);
                    }
                    dates.put(d);
                }
                result.put("dates", dates);

                // 数据列
                String[] cols = {"close", "volume", "amount", "pe_ttm_index"};
                String[] outCols = {"close", "volume", "amount", "pe"};
                for (int c = 0; c < cols.length; c++) {
                    JSONArray vals = table.optJSONArray(cols[c]);
                    if (vals != null) {
                        JSONArray out = new JSONArray();
                        for (int i = 0; i < vals.length(); i++) {
                            if (vals.isNull(i)) {
                                out.put(JSONObject.NULL);
                            } else {
                                out.put(vals.optDouble(i, 0));
                            }
                        }
                        result.put(outCols[c], out);
                    }
                }

                // changeRatio → change_pct
                JSONArray cr = table.optJSONArray("changeRatio");
                if (cr != null) {
                    result.put("change_pct", cr);
                }

                return result.toString();

            } catch (RuntimeException e) {
                if (e.getMessage().equals("NO_TOKEN")) {
                    return "{\"error\":\"NO_TOKEN\"}";
                }
                return "{\"error\":\"" + e.getMessage() + "\"}";
            } catch (Exception e) {
                return "{\"error\":\"" + e.getMessage() + "\"}";
            }
        }

        /**
         * 获取融资余额 (同步)
         * 返回 JSON: { dates:[], margin_balance:[] } 或 { error: "..." }
         */
        @JavascriptInterface
        public String fetchMargin(String ifindCode, String startDate, String endDate) {
            try {
                String token = ensureToken();
                JSONObject para = new JSONObject();
                para.put("codes", ifindCode);
                para.put("startdate", startDate.replace("-", ""));
                para.put("enddate", endDate.replace("-", ""));
                JSONObject fp = new JSONObject();
                fp.put("Days", "Tradedays");
                fp.put("Fill", "Previous");
                para.put("functionpara", fp);
                JSONArray indi = new JSONArray();
                JSONObject indiObj = new JSONObject();
                indiObj.put("indicator", "ths_margin_trading_balance_index");
                indiObj.put("indiparams", new JSONArray().put(""));
                indi.put(indiObj);
                para.put("indipara", indi);

                String resp = httpPost(IFIND_BASE + "/date_sequence",
                    para.toString(), token);
                JSONObject json = new JSONObject(resp);

                if (json.optInt("errorcode", -1) != 0) {
                    return "{\"error\":\"" + json.optString("error", "API error") + "\"}";
                }

                JSONArray tables = json.optJSONArray("tables");
                if (tables == null || tables.length() == 0) {
                    return "{\"dates\":[],\"margin_balance\":[]}";
                }

                JSONObject item = tables.getJSONObject(0);
                JSONObject table = item.optJSONObject("table");
                if (table == null) {
                    return "{\"dates\":[],\"margin_balance\":[]}";
                }

                JSONArray vals = table.optJSONArray("ths_margin_trading_balance_index");
                if (vals == null) {
                    return "{\"dates\":[],\"margin_balance\":[]}";
                }

                // 生成日期序列（从 startDate 开始，按自然日）
                JSONObject result = new JSONObject();
                java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd");
                java.util.Date start = sdf.parse(startDate);
                java.util.Date end = sdf.parse(endDate);
                JSONArray dates = new JSONArray();
                JSONArray mbArr = new JSONArray();
                java.util.Calendar cal = java.util.Calendar.getInstance();
                cal.setTime(start);
                int idx = 0;
                while (!cal.getTime().after(end) && idx < vals.length()) {
                    dates.put(sdf.format(cal.getTime()));
                    if (vals.isNull(idx)) {
                        mbArr.put(JSONObject.NULL);
                    } else {
                        mbArr.put(vals.optDouble(idx, 0));
                    }
                    cal.add(java.util.Calendar.DAY_OF_MONTH, 1);
                    idx++;
                }

                result.put("dates", dates);
                result.put("margin_balance", mbArr);
                return result.toString();

            } catch (RuntimeException e) {
                if (e.getMessage().equals("NO_TOKEN")) {
                    return "{\"error\":\"NO_TOKEN\"}";
                }
                return "{\"error\":\"" + e.getMessage() + "\"}";
            } catch (Exception e) {
                return "{\"error\":\"" + e.getMessage() + "\"}";
            }
        }

        /**
         * 测试 token 是否有效
         * 返回: { valid: true } 或 { valid: false, error: "..." }
         */
        @JavascriptInterface
        public String checkToken() {
            try {
                String token = ensureToken();
                return "{\"valid\":true}";
            } catch (RuntimeException e) {
                if (e.getMessage().equals("NO_TOKEN")) {
                    return "{\"valid\":false,\"error\":\"未设置token\"}";
                }
                return "{\"valid\":false,\"error\":\"" + e.getMessage() + "\"}";
            } catch (Exception e) {
                return "{\"valid\":false,\"error\":\"" + e.getMessage() + "\"}";
            }
        }
    }
}
