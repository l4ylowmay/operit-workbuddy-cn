/* METADATA
{
  "name": "workbuddy_media",
  "display_name": {
    "zh": "WorkBuddy 媒体生成"
  },
  "description": {
    "zh": "使用当前 WorkBuddy 账号的官方媒体服务生成图片或视频；会消耗 WorkBuddy 积分。异步提交后必须查询原任务，避免重复扣费。"
  },
  "enabledByDefault": true,
  "category": "Media",
  "tools": [
    {
      "name": "generate_image",
      "description": {
        "zh": "使用 WorkBuddy 生成图片。同步完成时直接使用 files 内的附件；只有异步任务才调用 query_task。不要重复提交。"
      },
      "parameters": [
        {
          "name": "prompt",
          "description": {
            "zh": "生成描述"
          },
          "type": "string",
          "required": true
        }
      ]
    },
    {
      "name": "generate_video",
      "description": {
        "zh": "使用 WorkBuddy 生成视频（当前实测上游502，未验收通过）。仅在用户要求时使用，异步任务按 taskId 查询，禁止失败后盲目重复提交。"
      },
      "parameters": [
        {
          "name": "prompt",
          "description": {
            "zh": "生成描述"
          },
          "type": "string",
          "required": true
        },
        {
          "name": "duration",
          "description": {
            "zh": "5 或 10 秒"
          },
          "type": "number",
          "required": false
        }
      ]
    },
    {
      "name": "query_task",
      "description": {
        "zh": "查询已有 WorkBuddy 图片/视频生成任务；完成时返回宿主媒体附件。"
      },
      "parameters": [
        {
          "name": "type",
          "description": {
            "zh": "image 或 video"
          },
          "type": "string",
          "required": true
        },
        {
          "name": "taskId",
          "description": {
            "zh": "提交时返回的任务 ID"
          },
          "type": "string",
          "required": true
        }
      ]
    }
  ]
}
*/
// SPDX-License-Identifier: MIT
"use strict";
const platform=require("./platform.js");
const {client}=require("./runtime.js");
const service=require("./media-service.js");
exports.generate_image = args => service.submit(platform,client,{...args,type:"image"});
exports.generate_video = args => service.submit(platform,client,{...args,type:"video"});
exports.query_task = args => service.query(platform,client,args);
