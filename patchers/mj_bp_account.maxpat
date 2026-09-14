{
	"patcher": {
		"fileversion": 1,
		"appversion": {
			"major": 9,
			"minor": 0,
			"revision": 3,
			"architecture": "x64",
			"modernui": 1
		},
		"classnamespace": "box",
		"rect": [
			100,
			100,
			680,
			1000
		],
		"openinpresentation": 1,
		"default_fontname": "Arial",
		"default_fontsize": 12,
		"boxes": [
			{
				"box": {
					"id": "balance",
					"maxclass": "live.text",
					"text": "—",
					"texton": "—",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"parameter_enable": 0,
					"mode": 0,
					"fontname": "Ableton Sans Bold",
					"fontsize": 26,
					"presentation": 1,
					"presentation_rect": [
						6,
						3,
						100,
						36
					],
					"patching_rect": [
						6,
						3,
						100,
						36
					],
					"bgcolor": [
						0,
						0,
						0,
						0
					],
					"bgoncolor": [
						0,
						0,
						0,
						0
					],
					"activebgcolor": [
						0,
						0,
						0,
						0
					],
					"activebgoncolor": [
						0,
						0,
						0,
						0
					],
					"textcolor": [
						1,
						1,
						1,
						1
					],
					"textoffcolor": [
						1,
						1,
						1,
						1
					],
					"activetextcolor": [
						1,
						1,
						1,
						1
					],
					"activetextoncolor": [
						1,
						1,
						1,
						1
					],
					"bordercolor": [
						0,
						0,
						0,
						0
					],
					"focusbordercolor": [
						0,
						0,
						0,
						0
					],
					"rounded": 6,
					"active": 0,
					"varname": "accountBalance",
					"hint": "Available balance"
				}
			},
			{
				"box": {
					"id": "dashboard",
					"maxclass": "live.text",
					"text": "↗",
					"texton": "↗",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"parameter_enable": 0,
					"mode": 0,
					"fontname": "Arial",
					"fontsize": 28,
					"presentation": 1,
					"presentation_rect": [
						112,
						3,
						32,
						36
					],
					"patching_rect": [
						112,
						3,
						32,
						36
					],
					"bgcolor": [
						0,
						0,
						0,
						0
					],
					"bgoncolor": [
						0,
						0,
						0,
						0
					],
					"activebgcolor": [
						0,
						0,
						0,
						0
					],
					"activebgoncolor": [
						0,
						0,
						0,
						0
					],
					"textcolor": [
						1,
						1,
						1,
						1
					],
					"textoffcolor": [
						1,
						1,
						1,
						1
					],
					"activetextcolor": [
						1,
						1,
						1,
						1
					],
					"activetextoncolor": [
						1,
						1,
						1,
						1
					],
					"bordercolor": [
						0,
						0,
						0,
						0
					],
					"focusbordercolor": [
						0,
						0,
						0,
						0
					],
					"rounded": 6,
					"active": 1,
					"varname": "accountDashboard",
					"hint": "Open Pollinations dashboard"
				}
			},
			{
				"box": {
					"id": "state",
					"maxclass": "inlet",
					"index": 1,
					"numinlets": 0,
					"numoutlets": 1,
					"patching_rect": [
						20,
						210,
						30,
						30
					]
				}
			},
			{
				"box": {
					"id": "commands",
					"maxclass": "outlet",
					"index": 1,
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						20,
						230,
						30,
						30
					]
				}
			},
			{
				"box": {
					"id": "state-route",
					"maxclass": "newobj",
					"text": "route balance",
					"numinlets": 2,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"patching_rect": [
						20,
						395,
						280,
						22
					]
				}
			},
			{
				"box": {
					"id": "dashboard-command",
					"maxclass": "message",
					"text": "accountDashboard",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						340,
						422,
						250,
						22
					]
				}
			},
			{
				"box": {
					"id": "ready",
					"maxclass": "newobj",
					"text": "loadbang",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						20,
						449,
						280,
						22
					]
				}
			},
			{
				"box": {
					"id": "ready-defer",
					"maxclass": "newobj",
					"text": "deferlow",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						20,
						476,
						280,
						22
					]
				}
			},
			{
				"box": {
					"id": "ready-status",
					"maxclass": "message",
					"text": "authStatus",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						340,
						503,
						250,
						22
					]
				}
			},
			{
				"box": {
					"id": "frame",
					"maxclass": "panel",
					"numinlets": 1,
					"numoutlets": 0,
					"presentation": 1,
					"presentation_rect": [
						0,
						0,
						150,
						42
					],
					"patching_rect": [
						0,
						0,
						150,
						42
					],
					"bgcolor": [
						0.008976,
						0,
						0.086957,
						1
					],
					"bordercolor": [
						0.252174,
						0.811837,
						1,
						1
					],
					"border": 2,
					"rounded": 8
				}
			}
		],
		"lines": [
			{
				"patchline": {
					"source": [
						"state",
						0
					],
					"destination": [
						"state-route",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"state-route",
						0
					],
					"destination": [
						"balance",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"dashboard",
						0
					],
					"destination": [
						"dashboard-command",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"dashboard-command",
						0
					],
					"destination": [
						"commands",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"ready",
						0
					],
					"destination": [
						"ready-defer",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"ready-defer",
						0
					],
					"destination": [
						"ready-status",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"ready-status",
						0
					],
					"destination": [
						"commands",
						0
					]
				}
			}
		]
	}
}
