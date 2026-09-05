package com.ianhandy.get2gethr;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceCalendarPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
